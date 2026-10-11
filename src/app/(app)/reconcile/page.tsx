"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/formatDate";
import {
  parseStatementLines,
  reconcile,
  type AppTransaction,
  type DateOrder,
  type MatchMode,
  type StatementRow,
} from "@/lib/statementParser";

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE" };
type Instrument = { id: string; name: string; type: string; currency: string; last4: string | null; archived: boolean };
type ApiTransaction = {
  id: string;
  amount: string;
  date: string;
  notes: string | null;
  category: { direction: "INCOME" | "EXPENSE" };
};

const MATCH_MODES: { value: MatchMode; label: string }[] = [
  { value: "AMOUNT_AND_DATE", label: "Amount and date" },
  { value: "AMOUNT_ONLY", label: "Amount only" },
  { value: "DATE_ONLY", label: "Date only" },
];

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function money(n: number, currency: string) {
  return `${currency} ${n.toFixed(2)}`;
}

export default function ReconcilePage() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [instrumentId, setInstrumentId] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [fileName, setFileName] = useState("");
  const [lines, setLines] = useState<string[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const [dateOrder, setDateOrder] = useState<DateOrder | "auto">("auto");
  const [matchMode, setMatchMode] = useState<MatchMode>("AMOUNT_AND_DATE");
  const [toleranceDays, setToleranceDays] = useState(3);
  const [includeCredits, setIncludeCredits] = useState(false);
  const [range, setRange] = useState({ from: "", to: "" });

  const [appTxns, setAppTxns] = useState<(AppTransaction & { direction: string })[]>([]);
  const [txnsLoading, setTxnsLoading] = useState(false);

  // Per-row choices for statement lines that aren't in the app yet, keyed
  // by row index in the parsed statement.
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [rowCategory, setRowCategory] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    (async () => {
      const [instRes, catRes] = await Promise.all([fetch("/api/instruments"), fetch("/api/categories")]);
      const insts: Instrument[] = (await instRes.json()).filter((i: Instrument) => !i.archived);
      // Credit cards first -- that's what statements are for -- but any
      // instrument can be reconciled.
      insts.sort((a, b) => Number(b.type === "CREDIT_CARD") - Number(a.type === "CREDIT_CARD"));
      setInstruments(insts);
      setCategories(await catRes.json());
      setInstrumentId(insts[0]?.id ?? "");
      setLoaded(true);
    })();
  }, []);

  const instrument = instruments.find((i) => i.id === instrumentId);
  const currency = instrument?.currency ?? "USD";
  const expenseCategories = categories.filter((c) => c.direction === "EXPENSE");
  const incomeCategories = categories.filter((c) => c.direction === "INCOME");

  const parsed = useMemo(() => {
    if (!lines) return null;
    // USD cards print MM/DD; INR/GBP/EUR cards almost always DD/MM.
    return parseStatementLines(lines, { dateOrder, fallbackOrder: currency === "USD" ? "MDY" : "DMY" });
  }, [lines, dateOrder, currency]);

  // Default the comparison window to the statement period printed on the
  // PDF, or to the span of the transaction dates when there isn't one.
  useEffect(() => {
    if (!parsed) return;
    if (parsed.period) {
      setRange({ from: parsed.period.start, to: parsed.period.end });
    } else if (parsed.rows.length) {
      const dates = parsed.rows.map((r) => r.date).sort();
      setRange({ from: dates[0], to: dates[dates.length - 1] });
    }
  }, [parsed]);

  async function loadAppTransactions() {
    if (!instrumentId || !range.from || !range.to) return;
    setTxnsLoading(true);
    // Widen by the date tolerance so a purchase logged a day before the
    // statement period still counts as a match for its first line.
    const params = new URLSearchParams({
      instrumentId,
      from: shiftDate(range.from, -toleranceDays),
      to: shiftDate(range.to, toleranceDays),
      limit: "500",
    });
    const res = await fetch(`/api/transactions?${params.toString()}`);
    const data: ApiTransaction[] = res.ok ? await res.json() : [];
    setAppTxns(
      data.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        date: t.date.slice(0, 10),
        notes: t.notes,
        direction: t.category.direction,
      }))
    );
    setTxnsLoading(false);
  }

  useEffect(() => {
    loadAppTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentId, range.from, range.to, toleranceDays]);

  // Statement rows considered for matching, keeping their original index so
  // selections survive toggling "include payments/credits".
  const statementRows = useMemo(() => {
    if (!parsed) return [] as { row: StatementRow; index: number }[];
    return parsed.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => includeCredits || !row.isCredit)
      .filter(({ row }) => (!range.from || row.date >= range.from) && (!range.to || row.date <= range.to));
  }, [parsed, includeCredits, range]);

  const result = useMemo(() => {
    // Purchases on a card are expenses in the app; credits/refunds are
    // income. Card payments are transfers, which never appear here.
    const candidates = appTxns.filter((t) => includeCredits || t.direction === "EXPENSE");
    return reconcile(
      statementRows.map((s) => s.row),
      candidates,
      matchMode,
      toleranceDays
    );
  }, [statementRows, appTxns, includeCredits, matchMode, toleranceDays]);

  // App transactions outside the statement period were only fetched to
  // allow for the date tolerance -- don't report them as "not on statement".
  const unmatchedAppInRange = result.unmatchedApp.filter(
    (t) => (!range.from || t.date >= range.from) && (!range.to || t.date <= range.to)
  );

  const missing = statementRows.filter((_, i) => !result.matches[i]);
  const foundCount = statementRows.length - missing.length;

  // Pre-select every missing row with a sensible default category.
  useEffect(() => {
    const nextSelected: Record<number, boolean> = {};
    const nextCategory: Record<number, string> = {};
    for (const { row, index } of missing) {
      nextSelected[index] = selected[index] ?? !row.isCredit;
      nextCategory[index] =
        rowCategory[index] ?? (row.isCredit ? incomeCategories[0]?.id : expenseCategories[0]?.id) ?? categories[0]?.id ?? "";
    }
    setSelected(nextSelected);
    setRowCategory(nextCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing.map((m) => m.index).join(","), categories.length]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setResultMessage(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF statements can be uploaded.");
      return;
    }
    setUploading(true);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/statements/parse", { method: "POST", body });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Couldn't read that PDF.");
      return;
    }
    setFileName(file.name);
    setSelected({});
    setRowCategory({});
    setLines(data.lines);
  }

  function reset() {
    setLines(null);
    setFileName("");
    setAppTxns([]);
    setRange({ from: "", to: "" });
    setError(null);
  }

  async function addSelected() {
    const toAdd = missing.filter(({ index }) => selected[index]);
    if (!toAdd.length) return;
    setError(null);
    setAdding(true);
    const res = await fetch("/api/transactions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instrumentId,
        currency,
        rows: toAdd.map(({ row, index }) => ({
          date: row.date,
          amount: row.amount,
          categoryId: rowCategory[index],
          notes: row.description,
        })),
      }),
    });
    setAdding(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Couldn't add those transactions.");
      return;
    }
    const body = await res.json();
    setResultMessage(`Added ${body.imported} transaction${body.imported === 1 ? "" : "s"} from the statement.`);
    await loadAppTransactions();
  }

  const selectedCount = missing.filter(({ index }) => selected[index]).length;
  const creditsHidden = parsed ? parsed.rows.filter((r) => r.isCredit).length : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reconcile statement</h1>
        <p className="text-sm text-gray-500">
          Upload a credit card statement PDF to check which of its transactions are already in the app and which are
          missing. The PDF is only read to extract its text — it isn&apos;t stored.
        </p>
      </div>

      {resultMessage && (
        <p className="rounded-lg border border-income-500/30 bg-income-500/5 p-3 text-sm text-income-600">{resultMessage}</p>
      )}
      {loaded && instruments.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Add your credit card on the Instruments page first, then come back to reconcile its statements.
        </div>
      )}

      {!lines && (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <div className="mx-auto max-w-sm">
            <label className="mb-1 block text-xs text-gray-500">Which card is this statement for?</label>
            <select
              value={instrumentId}
              onChange={(e) => setInstrumentId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.last4 ? ` ••${i.last4}` : ""} ({i.currency})
                </option>
              ))}
            </select>
          </div>
          <div className="text-center">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFile}
              disabled={uploading || !instrumentId}
              className="mx-auto text-sm"
            />
            <p className="mt-2 text-xs text-gray-400">
              {uploading ? "Reading statement..." : "PDF statements only (max 10 MB)."}
            </p>
          </div>
          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </div>
      )}

      {lines && parsed && (
        <>
          <div className="space-y-3 rounded-lg border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-700">
                <span className="font-medium">{fileName}</span> → {instrument?.name}
              </p>
              <button onClick={reset} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">
                Upload another statement
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Statement from</label>
                <input
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange({ ...range, from: e.target.value })}
                  className="w-full rounded-md border px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Statement to</label>
                <input
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange({ ...range, to: e.target.value })}
                  className="w-full rounded-md border px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Match on</label>
                <select
                  value={matchMode}
                  onChange={(e) => setMatchMode(e.target.value as MatchMode)}
                  className="w-full rounded-md border px-2 py-1.5 text-sm"
                >
                  {MATCH_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Date tolerance (days)</label>
                <input
                  type="number"
                  min={0}
                  max={15}
                  value={toleranceDays}
                  disabled={matchMode === "AMOUNT_ONLY"}
                  onChange={(e) => setToleranceDays(Math.max(0, Math.min(15, Number(e.target.value) || 0)))}
                  className="w-full rounded-md border px-2 py-1.5 text-sm disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Dates on statement</label>
                <select
                  value={dateOrder}
                  onChange={(e) => setDateOrder(e.target.value as DateOrder | "auto")}
                  className="w-full rounded-md border px-2 py-1.5 text-sm"
                >
                  <option value="auto">Auto ({parsed.dateOrder === "MDY" ? "MM/DD" : "DD/MM"})</option>
                  <option value="MDY">MM/DD (US)</option>
                  <option value="DMY">DD/MM (India/UK)</option>
                </select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm text-gray-600">
                <input type="checkbox" checked={includeCredits} onChange={(e) => setIncludeCredits(e.target.checked)} />
                Include payments & credits
              </label>
            </div>
            {!includeCredits && creditsHidden > 0 && (
              <p className="text-xs text-gray-400">
                {creditsHidden} payment/credit line{creditsHidden === 1 ? "" : "s"} hidden — card payments are tracked as
                transfers, not transactions.
              </p>
            )}
          </div>

          {parsed.rows.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Couldn&apos;t find any transaction lines in this PDF. Try switching the date format above. Scanned
              (image-only) statements can&apos;t be read — download the text version from your card issuer&apos;s website.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-white p-4">
                  <p className="text-xs text-gray-500">On statement</p>
                  <p className="text-2xl font-semibold">{statementRows.length}</p>
                </div>
                <div className="rounded-lg border bg-white p-4">
                  <p className="text-xs text-gray-500">Already in app</p>
                  <p className="text-2xl font-semibold text-income-600">{foundCount}</p>
                </div>
                <div className="rounded-lg border bg-white p-4">
                  <p className="text-xs text-gray-500">Missing from app</p>
                  <p className={`text-2xl font-semibold ${missing.length ? "text-red-600" : "text-gray-900"}`}>
                    {missing.length}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                  <h2 className="text-sm font-medium text-gray-700">
                    Statement transactions {txnsLoading && <span className="text-gray-400">(checking...)</span>}
                  </h2>
                  {missing.length > 0 && (
                    <button
                      onClick={addSelected}
                      disabled={adding || selectedCount === 0}
                      className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {adding ? "Adding..." : `Add ${selectedCount} missing to app`}
                    </button>
                  )}
                </div>
                <div className="max-h-[32rem] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b text-left text-gray-500">
                        <th className="p-2">Status</th>
                        <th className="p-2">Date</th>
                        <th className="p-2">Description</th>
                        <th className="p-2 text-right">Amount</th>
                        <th className="p-2">In app / add as</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statementRows.map(({ row, index }, i) => {
                        const match = result.matches[i];
                        return (
                          <tr key={index} className={`border-b last:border-0 ${match ? "" : "bg-red-50/50"}`}>
                            <td className="whitespace-nowrap p-2">
                              {match ? (
                                <span className="rounded-full bg-income-500/10 px-2 py-0.5 text-xs text-income-600">✓ Recorded</span>
                              ) : (
                                <label className="flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={!!selected[index]}
                                    onChange={(e) => setSelected({ ...selected, [index]: e.target.checked })}
                                  />
                                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Missing</span>
                                </label>
                              )}
                            </td>
                            <td className="whitespace-nowrap p-2">{formatDate(row.date)}</td>
                            <td className="max-w-xs truncate p-2 text-gray-600" title={row.rawLine}>
                              {row.description}
                            </td>
                            <td className={`whitespace-nowrap p-2 text-right ${row.isCredit ? "text-income-600" : ""}`}>
                              {row.isCredit ? "−" : ""}
                              {money(row.amount, currency)}
                            </td>
                            <td className="p-2 text-xs text-gray-500">
                              {match ? (
                                <span title={match.notes ?? ""}>
                                  {formatDate(match.date)} · {money(Math.abs(match.amount), currency)}
                                  {match.notes ? ` · ${match.notes}` : ""}
                                </span>
                              ) : (
                                <select
                                  value={rowCategory[index] ?? ""}
                                  onChange={(e) => setRowCategory({ ...rowCategory, [index]: e.target.value })}
                                  className="rounded border px-2 py-1 text-xs"
                                >
                                  {categories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name} ({c.direction === "INCOME" ? "Income" : "Expense"})
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border bg-white">
                <div className="border-b p-3">
                  <h2 className="text-sm font-medium text-gray-700">In the app but not on this statement</h2>
                  <p className="text-xs text-gray-400">
                    Logged against {instrument?.name} in this date range with no matching statement line — possibly a
                    duplicate, a wrong amount/date, or logged to the wrong card.
                  </p>
                </div>
                {unmatchedAppInRange.length === 0 ? (
                  <p className="p-3 text-sm text-gray-500">None — everything in the app for this period is on the statement.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {unmatchedAppInRange.map((t) => (
                        <tr key={t.id} className="border-b last:border-0">
                          <td className="whitespace-nowrap p-2">{formatDate(t.date)}</td>
                          <td className="p-2 text-gray-600">{t.notes ?? "—"}</td>
                          <td className="whitespace-nowrap p-2 text-right">{money(Math.abs(t.amount), currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div>
            <button onClick={() => setShowRaw((v) => !v)} className="text-xs text-gray-400 hover:text-gray-600">
              {showRaw ? "Hide" : "Show"} extracted text ({lines.length} lines)
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg border bg-gray-50 p-3 text-xs text-gray-600">
                {lines.join("\n")}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}
