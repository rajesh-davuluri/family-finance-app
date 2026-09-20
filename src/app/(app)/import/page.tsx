"use client";

import { useState } from "react";
import Papa from "papaparse";
import { CURRENCIES } from "@/lib/enums";

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE" };
type Instrument = { id: string; name: string; currency: string; archived: boolean };

type PreviewRow = {
  rawDate: string;
  rawDescription: string;
  rawAmount: string;
  date: string; // normalized YYYY-MM-DD
  amount: number;
  categoryId: string;
  include: boolean;
};

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
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

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

  function proceedToPreview() {
    if (!columnMap.date || !columnMap.description || !columnMap.amount) {
      setError("Map all three columns before continuing.");
      return;
    }
    setError(null);
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
        include: amount > 0,
      };
    });
    setRows(preview);
    setStep("preview");
  }

  function applyBulkCategory() {
    setRows((rs) => rs.map((r) => ({ ...r, categoryId: bulkCategoryId })));
  }

  function updateRow(index: number, patch: Partial<PreviewRow>) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleImport() {
    setError(null);
    setSubmitting(true);
    const included = rows.filter((r) => r.include);
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
  }

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
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Preview {rawRows.length} row{rawRows.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-4">
            <span className="text-sm text-gray-500">Apply category to all rows:</span>
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
            <button onClick={applyBulkCategory} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">
              Apply to all
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
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
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
                    </td>
                  </tr>
                ))}
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
    </div>
  );
}
