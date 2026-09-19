"use client";

import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import { formatDate, getTodayLocal } from "@/lib/formatDate";

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE" };
type Instrument = { id: string; name: string; archived: boolean };
type Template = {
  id: string;
  amount: string;
  currency: string;
  notes: string | null;
  frequency: string;
  nextRunAt: string;
  active: boolean;
  category: Category;
  instrument: Instrument;
};

const FREQ_LABELS: Record<string, string> = { WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" };

export default function RecurringPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    amount: "",
    currency: "USD",
    notes: "",
    frequency: "MONTHLY",
    nextRunAt: getTodayLocal(),
    categoryId: "",
    instrumentId: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const [tRes, cRes, iRes] = await Promise.all([
      fetch("/api/recurring"),
      fetch("/api/categories"),
      fetch("/api/instruments"),
    ]);
    const templatesData = await tRes.json();
    const cats = await cRes.json();
    const insts = await iRes.json();
    setTemplates(templatesData);
    setCategories(cats);
    setInstruments(insts);
    setForm((f) => ({
      ...f,
      categoryId: f.categoryId || cats[0]?.id || "",
      instrumentId: f.instrumentId || insts.find((i: Instrument) => !i.archived)?.id || "",
    }));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't save that template.");
      return;
    }
    setForm((f) => ({ ...f, amount: "", notes: "" }));
    load();
  }

  async function toggleActive(id: string, active: boolean) {
    await fetch(`/api/recurring/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this recurring template? Already-generated transactions stay put.")) return;
    await fetch(`/api/recurring/${id}`, { method: "DELETE" });
    load();
  }

  async function generateNow() {
    setGenerating(true);
    setGenMessage(null);
    const res = await fetch("/api/cron/generate-recurring");
    const body = await res.json();
    setGenerating(false);
    if (res.ok) {
      setGenMessage(`Generated ${body.transactionsGenerated} transaction(s) from ${body.processedTemplates} due template(s).`);
      load();
    } else {
      setGenMessage(body.error ?? "Couldn't generate — check CRON_SECRET is set correctly if this is deployed.");
    }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Recurring transactions</h1>
        <button
          onClick={generateNow}
          disabled={generating}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {generating ? "Generating..." : "Generate now"}
        </button>
      </div>
      <p className="text-sm text-gray-500">
        Templates for bills or income that repeat automatically. On a deployed site, these generate on a schedule (see
        the README's Vercel Cron setup) — locally, use "Generate now" to trigger it manually.
      </p>
      {genMessage && <p className="text-sm text-brand-700">{genMessage}</p>}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-6">
        <input
          type="number"
          step="0.01"
          min="0.01"
          required
          placeholder="Amount"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        />
        <select
          value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={form.categoryId}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={form.instrumentId}
          onChange={(e) => setForm({ ...form, instrumentId: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {instruments
            .filter((i) => !i.archived)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </select>
        <select
          value={form.frequency}
          onChange={(e) => setForm({ ...form, frequency: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {Object.entries(FREQ_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          required
          value={form.nextRunAt}
          onChange={(e) => setForm({ ...form, nextRunAt: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        />
        <input
          type="text"
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm sm:col-span-3"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:col-span-3"
        >
          {submitting ? "Saving..." : "Add recurring template"}
        </button>
        {error && <p className="text-sm text-red-600 sm:col-span-6">{error}</p>}
      </form>

      <div className="rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="p-3">Next run</th>
              <th className="p-3">Frequency</th>
              <th className="p-3">Category</th>
              <th className="p-3">Instrument</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="p-3">{formatDate(t.nextRunAt)}</td>
                <td className="p-3">{FREQ_LABELS[t.frequency] ?? t.frequency}</td>
                <td className="p-3">{t.category.name}</td>
                <td className="p-3">{t.instrument.name}</td>
                <td className="p-3 text-right">
                  {t.currency} {Number(t.amount).toFixed(2)}
                </td>
                <td className="p-3">
                  <span className={t.active ? "text-green-600" : "text-gray-400"}>
                    {t.active ? "Active" : "Paused"}
                  </span>
                </td>
                <td className="space-x-3 p-3 text-right">
                  <button onClick={() => toggleActive(t.id, t.active)} className="text-xs text-brand-600 hover:underline">
                    {t.active ? "Pause" : "Resume"}
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="text-xs text-red-500 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gray-400">
                  No recurring templates yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
