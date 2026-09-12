"use client";

import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/enums";

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE" };
type Instrument = { id: string; name: string; currency: string; archived: boolean };
type Transaction = {
  id: string;
  amount: string;
  currency: string;
  date: string;
  notes: string | null;
  category: Category;
  instrument: Instrument;
  createdBy?: { name: string };
};

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    amount: "",
    currency: "USD",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
    categoryId: "",
    instrumentId: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [txRes, catRes, instRes] = await Promise.all([
      fetch("/api/transactions"),
      fetch("/api/categories"),
      fetch("/api/instruments"),
    ]);
    setTransactions(await txRes.json());
    const cats = await catRes.json();
    const insts = await instRes.json();
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
    loadAll();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.categoryId || !form.instrumentId) {
      setError("Add a category and a payment instrument first (see the Categories / Instruments pages).");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't save that transaction.");
      return;
    }
    setForm((f) => ({ ...f, amount: "", notes: "" }));
    loadAll();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this transaction? This can't be undone.")) return;
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    loadAll();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  const noSetupYet = categories.length === 0 || instruments.length === 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Transactions</h1>

      {noSetupYet && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You need at least one category and one payment instrument before adding transactions. Set those up on the{" "}
          <a href="/categories" className="underline">
            Categories
          </a>{" "}
          and{" "}
          <a href="/instruments" className="underline">
            Instruments
          </a>{" "}
          pages first.
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-6">
        <input
          type="number"
          step="0.01"
          min="0.01"
          required
          placeholder="Amount"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm sm:col-span-1"
        />
        <select
          value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm sm:col-span-1"
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
          className="rounded-md border px-3 py-2 text-sm sm:col-span-1"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.direction === "INCOME" ? "Income" : "Expense"})
            </option>
          ))}
        </select>
        <select
          value={form.instrumentId}
          onChange={(e) => setForm({ ...form, instrumentId: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm sm:col-span-1"
        >
          {instruments
            .filter((i) => !i.archived)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </select>
        <input
          type="date"
          required
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm sm:col-span-1"
        />
        <input
          type="text"
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm sm:col-span-1"
        />
        <button
          type="submit"
          disabled={submitting || noSetupYet}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:col-span-6"
        >
          {submitting ? "Adding..." : "Add transaction"}
        </button>
        {error && <p className="text-sm text-red-600 sm:col-span-6">{error}</p>}
      </form>

      <div className="rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="p-3">Date</th>
              <th className="p-3">Category</th>
              <th className="p-3">Instrument</th>
              <th className="p-3">Notes</th>
              <th className="p-3">Added by</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="p-3">{new Date(t.date).toLocaleDateString()}</td>
                <td className="p-3">{t.category.name}</td>
                <td className="p-3">{t.instrument.name}</td>
                <td className="p-3 text-gray-500">{t.notes || "—"}</td>
                <td className="p-3 text-gray-500">{t.createdBy?.name ?? "—"}</td>
                <td
                  className={`p-3 text-right font-medium ${
                    t.category.direction === "INCOME" ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {t.category.direction === "INCOME" ? "+" : "-"}
                  {t.currency} {Number(t.amount).toFixed(2)}
                </td>
                <td className="p-3 text-right">
                  <button onClick={() => handleDelete(t.id)} className="text-xs text-red-500 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gray-400">
                  No transactions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
