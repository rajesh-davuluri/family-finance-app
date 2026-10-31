"use client";

import { useEffect, useState } from "react";
import Papa from "papaparse";
import { CURRENCIES } from "@/lib/enums";
import { formatDate } from "@/lib/formatDate";
import { LastActivity, STALE_AFTER_DAYS, daysSince, formatDateTime } from "@/lib/lastActivity";

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE" };
type Instrument = { id: string; name: string; currency: string; archived: boolean };

type ExistingMatch = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  notes: string | null;
  categoryName: string;
  instrumentName: string;
  sameInstrument: boolean;
};

type ImportRecord = {
  id: string;
  fileName: string;
  currency: string;
  rowsInFile: number;
  importedCount: number;
  duplicateCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  instrumentName: string;
  createdByName: string;
  createdAt: string;
};

type PreviewRow = {
  rawDate: string;
  rawDescription: string;
  rawAmount: string;
  date: string; // normalized YYYY-MM-DD
  amount: number;
  categoryId: string;
  // Category guessed from past transactions with the same merchant, if any.
  // The row shows as "auto" while categoryId still equals it.
  suggestedCategoryId: string | null;
  include: boolean;
  // Existing transaction with the same date + amount, found when the preview
  // was built. Only shown while the row's date/amount still match it.
  match: ExistingMatch | null;
};

function isAutoCategorized(r: PreviewRow) {
  return r.suggestedCategoryId !== null && r.categoryId === r.suggestedCategoryId;
}

function isDuplicate(r: PreviewRow) {
  return !!r.match && r.match.date === r.date && Math.round(r.match.amount * 100) === Math.round(r.amount * 100);
}

function normalizeDate(raw: string): string {
  // Handles "2026-09-15", "09/15/2026", and "9/15/26" -- the common shapes
  // banks and card issuers export. Falls back to today's date string if it
  // genuinely can't be parsed, so the row is still editable rather than
  // silently dropped.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) {
    let [, m, d, y] = slash;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return new Date().toISOString().slice(0, 10);
}

export default function ImportPage() {
  const [step, setStep] = useState<"upload" | "map" | "preview">("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [columnMap, setColumnMap] = useState({ date: "", description: "", amount: "" });

  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [instrumentId, setInstrumentId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [loaded, setLoaded] = useState(false);

  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const [fileName, setFileName] = useState("");
  const [history, setHistory] = useState<ImportRecord[] | null>(null);
  const [historyError, setHistoryError] = useState(false);

  async function loadHistory() {
    try {
      const res = await fetch("/api/imports");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHistory(await res.json());
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }

  const [lastActivity, setLastActivity] = useState<LastActivity | null>(null);

  async function loadLastActivity() {
    try {
      const res = await fetch("/api/transactions/last-activity");
      if (res.ok) setLastActivity(await res.json());
    } catch {
      // Non-essential -- the section just stays hidden.
    }
  }

  useEffect(() => {
    loadHistory();
    loadLastActivity();
  }, []);

  async function ensureOptionsLoaded() {
    if (loaded) return;
    const [instRes, catRes] = await Promise.all([fetch("/api/instruments"), fetch("/api/categories")]);
    const insts: Instrument[] = await instRes.json();
    const cats: Category[] = await catRes.json();
    setInstruments(insts.filter((i) => !i.archived));
    setCategories(cats);
    setInstrumentId(insts.find((i) => !i.archived)?.id ?? "");
    setCurrency(insts.find((i) => !i.archived)?.currency ?? "USD");
    setBulkCategoryId(cats.find((c) => c.direction === "EXPENSE")?.id ?? "");
    setLoaded(true);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResultMessage(null);
    setFileName(file.name);
    await ensureOptionsLoaded();

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data.length) {
          setError("Couldn't find any rows in that file.");
          return;
        }
        setHeaders(results.meta.fields ?? []);
        setRawRows(results.data);
        // Best-effort guess at column mapping so the person usually just
        // has to confirm rather than pick from scratch.
        const guess = (candidates: string[]) =>
          results.meta.fields?.find((f) => candidates.some((c) => f.toLowerCase().includes(c))) ?? "";
        setColumnMap({
          date: guess(["date"]),
          description: guess(["description", "memo", "payee", "merchant"]),
          amount: guess(["amount"]),
        });
        setStep("map");
      },
      error: () => setError("Couldn't read that file — make sure it's a valid CSV."),
    });
  }

  async function findExistingMatches(preview: PreviewRow[]): Promise<(ExistingMatch | null)[] | null> {
    const res = await fetch("/api/transactions/bulk/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrumentId, rows: preview.map((r) => ({ date: r.date, amount: r.amount })) }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.matches;
  }

  async function suggestCategories(preview: PreviewRow[]): Promise<({ categoryId: string } | null)[] | null> {
    try {
      const res = await fetch("/api/transactions/bulk/suggest-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptions: preview.map((r) => r.rawDescription) }),
      });
      if (!res.ok) return null;
      return (await res.json()).suggestions;
    } catch {
      return null;
    }
  }

  async function proceedToPreview() {
    if (!columnMap.date || !columnMap.description || !columnMap.amount) {
      setError("Map all three columns before continuing.");
      return;
    }
    setError(null);
    setShowOnlyDuplicates(false);
    const defaultCategoryId = bulkCategoryId;
    const preview: PreviewRow[] = rawRows.map((r) => {
      const rawAmount = r[columnMap.amount] ?? "";
      const amount = Math.abs(parseFloat(rawAmount.replace(/[^0-9.-]/g, "")) || 0);
      return {
        rawDate: r[columnMap.date] ?? "",
        rawDescription: r[columnMap.description] ?? "",
        rawAmount,
        date: normalizeDate(r[columnMap.date] ?? ""),
        amount,
        categoryId: defaultCategoryId,
        suggestedCategoryId: null,
        include: amount > 0,
        match: null,
      };
    });

    // Before anything is inserted, look for transactions already in the app
    // with the same date and amount, and leave those rows unchecked.
    // Alongside that, fill in categories learned from past transactions.
    setChecking(true);
    const [matches, suggestions] = await Promise.all([findExistingMatches(preview), suggestCategories(preview)]);
    setChecking(false);
    const knownCategoryIds = new Set(categories.map((c) => c.id));
    suggestions?.forEach((sug, i) => {
      if (sug && knownCategoryIds.has(sug.categoryId)) {
        preview[i].categoryId = sug.categoryId;
        preview[i].suggestedCategoryId = sug.categoryId;
      }
    });
    if (matches) {
      preview.forEach((r, i) => {
        r.match = matches[i] ?? null;
        if (r.match) r.include = false;
      });
    } else {
      setError("Couldn't check for transactions already in the app — review the rows carefully before importing.");
    }
    setRows(preview);
    setStep("preview");
  }

  // By default only rows without an automatic suggestion are changed, so
  // picking a catch-all category doesn't wipe out the learned ones.
  function applyBulkCategory(includeAuto: boolean) {
    setRows((rs) => rs.map((r) => (includeAuto || !isAutoCategorized(r) ? { ...r, categoryId: bulkCategoryId } : r)));
  }

  function updateRow(index: number, patch: Partial<PreviewRow>) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleImport() {
    setError(null);
    setSubmitting(true);
    const included = rows.filter((r) => r.include);
    const dates = rows.map((r) => r.date).sort();
    const res = await fetch("/api/transactions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instrumentId,
        currency,
        rows: included.map((r) => ({
          date: r.date,
          amount: r.amount,
          categoryId: r.categoryId,
          notes: r.rawDescription || undefined,
        })),
        file: {
          name: fileName || "Unnamed file",
          rowsInFile: rows.length,
          duplicateCount: rows.filter(isDuplicate).length,
          periodStart: dates[0],
          periodEnd: dates[dates.length - 1],
        },
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Import failed — check the rows and try again.");
      return;
    }
    const body = await res.json();
    setResultMessage(`Imported ${body.imported} transaction${body.imported === 1 ? "" : "s"}.`);
    setStep("upload");
    setRawRows([]);
    setRows([]);
    loadHistory();
    loadLastActivity();
  }

  const duplicateCount = rows.filter(isDuplicate).length;
  const autoCount = rows.filter(isAutoCategorized).length;
  const lastImport = history?.[0];
  // Earlier imports of a file with the same name -- most likely the same
  // statement being brought in a second time.
  const sameFileImports = fileName
    ? (history ?? []).filter((h) => h.fileName.toLowerCase() === fileName.toLowerCase())
    : [];

  const noSetupYet = loaded && (instruments.length === 0 || categories.length === 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Import transactions</h1>
        <p className="text-sm text-gray-500">
          Upload a CSV export from a bank or credit card statement — map its columns, assign categories, and import
          in bulk instead of entering rows one at a time.
        </p>
      </div>

      {resultMessage && <p className="rounded-lg border border-income-500/30 bg-income-500/5 p-3 text-sm text-income-600">{resultMessage}</p>}
      {noSetupYet && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You need at least one category and one payment instrument before importing — set those up first.
        </div>
      )}

      {step === "upload" && lastActivity && lastActivity.instruments.length > 0 && (
        <RecordsUpTo instruments={lastActivity.instruments} />
      )}

      {step === "upload" && lastImport && (
        <p className="rounded-lg border bg-white p-3 text-sm text-gray-600">
          <span className="font-medium text-ink-900">Last import:</span> {formatDateTime(lastImport.createdAt)} —{" "}
          <span className="font-medium">{lastImport.fileName}</span> into {lastImport.instrumentName} (
          {lastImport.importedCount} transaction{lastImport.importedCount === 1 ? "" : "s"}
          {lastImport.periodStart && lastImport.periodEnd && (
            <>, covering {formatDate(lastImport.periodStart)} – {formatDate(lastImport.periodEnd)}</>
          )}
          )
        </p>
      )}

      {step !== "upload" && sameFileImports.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          You&apos;ve imported a file named <span className="font-medium">{fileName}</span> before —{" "}
          {sameFileImports
            .map((h) => `${formatDateTime(h.createdAt)} into ${h.instrumentName} (${h.importedCount} transactions)`)
            .join("; ")}
          . Make sure this isn&apos;t the same statement again.
        </div>
      )}

      {step === "upload" && (
        <div className="rounded-lg border bg-white p-6 text-center">
          <input type="file" accept=".csv" onChange={handleFile} className="mx-auto text-sm" />
          <p className="mt-2 text-xs text-gray-400">CSV files only, with a header row.</p>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      )}

      {step === "map" && (
        <div className="space-y-4 rounded-lg border bg-white p-4">
          <h2 className="text-sm font-medium text-gray-700">Match the columns from your file</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["date", "description", "amount"] as const).map((field) => (
              <div key={field}>
                <label className="mb-1 block text-xs capitalize text-gray-500">{field}</label>
                <select
                  value={columnMap[field]}
                  onChange={(e) => setColumnMap({ ...columnMap, [field]: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">Choose column...</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Import into which account?</label>
              <select
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Currency for this file</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setStep("upload")} className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50">
              Back
            </button>
            <button
              onClick={proceedToPreview}
              disabled={checking}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {checking ? "Checking existing transactions & categories..." : `Preview ${rawRows.length} row${rawRows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          {duplicateCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span>
                {duplicateCount} of {rows.length} row{rows.length === 1 ? "" : "s"} match a transaction already in the app
                (same date and amount). They&apos;re unchecked so they won&apos;t be imported again — tick any that are
                genuinely new.
              </span>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={showOnlyDuplicates}
                  onChange={(e) => setShowOnlyDuplicates(e.target.checked)}
                />
                Show only these rows
              </label>
            </div>
          ) : (
            rows.length > 0 &&
            !error && (
              <p className="rounded-lg border border-income-500/30 bg-income-500/5 p-3 text-sm text-income-600">
                None of these rows match a transaction already in the app.
              </p>
            )
          )}

          {autoCount > 0 ? (
            <p className="rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm text-ink-800">
              <span className="font-medium">
                {autoCount} of {rows.length} row{rows.length === 1 ? "" : "s"} categorized automatically
              </span>{" "}
              from your past transactions (marked <AutoBadge />). Check the other {rows.length - autoCount} — they use the
              category below.
            </p>
          ) : (
            rows.length > 0 && (
              <p className="rounded-lg border bg-white p-3 text-sm text-gray-500">
                No rows matched merchants from your past transactions yet — pick categories below. Future imports will
                learn from what you choose here.
              </p>
            )
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-4">
            <span className="text-sm text-gray-500">Category for rows without a suggestion:</span>
            <select
              value={bulkCategoryId}
              onChange={(e) => setBulkCategoryId(e.target.value)}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.direction === "INCOME" ? "Income" : "Expense"})
                </option>
              ))}
            </select>
            <button onClick={() => applyBulkCategory(false)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">
              Apply to uncategorized rows
            </button>
            <button
              onClick={() => applyBulkCategory(true)}
              className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:underline"
            >
              Apply to all rows
            </button>
          </div>

          <div className="max-h-[28rem] overflow-y-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b text-left text-gray-500">
                  <th className="p-2">Include</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Description</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Already in app?</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const dup = isDuplicate(r);
                  if (showOnlyDuplicates && !dup) return null;
                  return (
                  <tr key={i} className={`border-b last:border-0 ${dup ? "bg-amber-50" : ""}`}>
                    <td className="p-2">
                      <input type="checkbox" checked={r.include} onChange={(e) => updateRow(i, { include: e.target.checked })} />
                    </td>
                    <td className="p-2">
                      <input
                        type="date"
                        value={r.date}
                        onChange={(e) => updateRow(i, { date: e.target.value })}
                        className="rounded border px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="max-w-xs truncate p-2 text-gray-600" title={r.rawDescription}>
                      {r.rawDescription}
                    </td>
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={r.amount}
                        onChange={(e) => updateRow(i, { amount: parseFloat(e.target.value) || 0 })}
                        className="w-24 rounded border px-2 py-1 text-right text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={r.categoryId}
                        onChange={(e) => updateRow(i, { categoryId: e.target.value })}
                        className="rounded border px-2 py-1 text-xs"
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {isAutoCategorized(r) && (
                        <span className="ml-1">
                          <AutoBadge />
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-xs">
                      {dup && r.match ? (
                        <span
                          className="text-amber-800"
                          title={r.match.notes ? `Existing note: ${r.match.notes}` : undefined}
                        >
                          Yes — {formatDate(r.match.date)}, {r.match.currency} {r.match.amount.toFixed(2)}
                          <span className="block text-amber-700/80">
                            {r.match.categoryName} · {r.match.instrumentName}
                            {!r.match.sameInstrument && " (different account)"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-400">New</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setStep("map")} className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50">
              Back
            </button>
            <button
              onClick={handleImport}
              disabled={submitting}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? "Importing..." : `Import ${rows.filter((r) => r.include).length} transaction(s)`}
            </button>
          </div>
        </div>
      )}

      {step === "upload" && <ImportHistory history={history} failed={historyError} />}
    </div>
  );
}

function ImportHistory({ history, failed }: { history: ImportRecord[] | null; failed: boolean }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-gray-700">Import history</h2>
      {failed && history === null ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn&apos;t load import history. If this was just deployed, the database may still need its update
          (<code>npx prisma migrate deploy</code>).
        </p>
      ) : history === null ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : history.length === 0 ? (
        <p className="rounded-lg border bg-white p-4 text-sm text-gray-500">
          No imports yet — files you import will be listed here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="p-2">Imported on</th>
                <th className="p-2">File</th>
                <th className="p-2">Account</th>
                <th className="p-2">Statement period</th>
                <th className="p-2 text-right">Imported</th>
                <th className="p-2 text-right">Skipped</th>
                <th className="p-2">By</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const skipped = h.rowsInFile - h.importedCount;
                return (
                  <tr key={h.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap p-2 text-gray-600">{formatDateTime(h.createdAt)}</td>
                    <td className="max-w-xs truncate p-2 font-medium" title={h.fileName}>
                      {h.fileName}
                    </td>
                    <td className="p-2 text-gray-600">{h.instrumentName}</td>
                    <td className="whitespace-nowrap p-2 text-gray-600">
                      {h.periodStart && h.periodEnd ? `${formatDate(h.periodStart)} – ${formatDate(h.periodEnd)}` : "—"}
                    </td>
                    <td className="p-2 text-right">{h.importedCount}</td>
                    <td
                      className="p-2 text-right text-gray-500"
                      title={h.duplicateCount ? `${h.duplicateCount} already in the app` : undefined}
                    >
                      {skipped}
                      {h.duplicateCount > 0 && <span className="text-xs text-amber-700"> ({h.duplicateCount} dup.)</span>}
                    </td>
                    <td className="p-2 text-gray-600">{h.createdByName}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  BANK_ACCOUNT: "Bank account",
  CREDIT_CARD: "Credit card",
  CASH: "Cash",
  OTHER: "Other",
};

// Per account: the latest transaction date on record (so you know which
// statement period to import next) and when anything was last added.
function RecordsUpTo({ instruments }: { instruments: LastActivity["instruments"] }) {
  // Credit cards first -- they're what gets imported from statements.
  const sorted = [...instruments].sort(
    (a, b) => Number(b.type === "CREDIT_CARD") - Number(a.type === "CREDIT_CARD") || a.name.localeCompare(b.name)
  );
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-gray-700">Where your records are up to</h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="p-2">Account</th>
              <th className="p-2">Latest transaction dated</th>
              <th className="p-2">Last added</th>
              <th className="p-2 text-right">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((i) => {
              const stale = i.latestTransactionDate !== null && daysSince(i.latestTransactionDate) >= STALE_AFTER_DAYS;
              return (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="p-2">
                    <span className="font-medium">{i.name}</span>
                    {i.last4 && <span className="text-gray-400"> ({i.last4})</span>}
                    <span className="block text-xs text-gray-400">{TYPE_LABELS[i.type] ?? i.type}</span>
                  </td>
                  <td className={`whitespace-nowrap p-2 ${stale ? "text-amber-700" : "text-gray-600"}`}>
                    {i.latestTransactionDate ? (
                      <>
                        {formatDate(i.latestTransactionDate)}
                        <span className="block text-xs">
                          {daysSince(i.latestTransactionDate)} days ago{stale && " — import newer statements"}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400">Nothing yet</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-2 text-gray-600">
                    {i.lastAddedAt ? formatDateTime(i.lastAddedAt) : "—"}
                  </td>
                  <td className="p-2 text-right text-gray-600">{i.transactionCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AutoBadge() {
  return (
    <span
      className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-700"
      title="Category learned from your past transactions with this merchant"
    >
      auto
    </span>
  );
}
