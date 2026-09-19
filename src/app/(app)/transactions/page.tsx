"use client";

import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import AddTransactionModal, { EditableTransaction } from "@/components/AddTransactionModal";
import { formatDate, getTodayLocal } from "@/lib/formatDate";

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

const EMPTY_SEARCH = { from: "", to: "", instrumentId: "", categoryId: "" };

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [txnsLoading, setTxnsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");

  // Search criteria: date range, card/instrument, category. All optional --
  // sent to the API as query params so filtering happens server-side and
  // scales with transaction history instead of only searching what's
  // already loaded on the page.
  const [search, setSearch] = useState(EMPTY_SEARCH);

  // Editing an existing transaction reuses the same modal as adding one.
  const [editingTransaction, setEditingTransaction] = useState<EditableTransaction | null>(null);

  const [form, setForm] = useState({
    amount: "",
    currency: "USD",
    date: getTodayLocal(),
    notes: "",
    categoryId: "",
    instrumentId: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function loadTransactions(criteria = search) {
    setTxnsLoading(true);
    const params = new URLSearchParams({ limit: "500" });
    if (criteria.from) params.set("from", criteria.from);
    if (criteria.to) params.set("to", criteria.to);
    if (criteria.instrumentId) params.set("instrumentId", criteria.instrumentId);
    if (criteria.categoryId) params.set("categoryId", criteria.categoryId);
    const res = await fetch(`/api/transactions?${params.toString()}`);
    setTransactions(await res.json());
    setTxnsLoading(false);
  }

  async function loadAll() {
    setLoading(true);
    const [catRes, instRes] = await Promise.all([fetch("/api/categories"), fetch("/api/instruments")]);
    const cats = await catRes.json();
    const insts = await instRes.json();
    setCategories(cats);
    setInstruments(insts);
    setForm((f) => ({
      ...f,
      categoryId: f.categoryId || cats[0]?.id || "",
      instrumentId: f.instrumentId || insts.find((i: Instrument) => !i.archived)?.id || "",
    }));
    await loadTransactions(EMPTY_SEARCH);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateSearch(patch: Partial<typeof search>) {
    const next = { ...search, ...patch };
    setSearch(next);
    loadTransactions(next);
  }

  function clearSearch() {
    setSearch(EMPTY_SEARCH);
    loadTransactions(EMPTY_SEARCH);
  }

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
    loadTransactions();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this transaction? This can't be undone.")) return;
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    loadTransactions();
  }

  function handleEditSuccess() {
    setEditingTransaction(null);
    loadTransactions();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  const noSetupYet = categories.length === 0 || instruments.length === 0;

  const filteredTransactions = transactions.filter((t) => filter === "ALL" || t.category.direction === filter);
  const filteredTotal = filteredTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const searchActive = search.from || search.to || search.instrumentId || search.categoryId;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Transactions</h1>

      <AddTransactionModal
        open={!!editingTransaction}
        onClose={() => setEditingTransaction(null)}
        onSuccess={handleEditSuccess}
        editingTransaction={editingTransaction}
      />

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

      {/* Search criteria */}
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Search</h2>
          {searchActive && (
            <button onClick={clearSearch} className="text-xs text-brand-600 hover:underline">
              Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">From date</label>
            <input
              type="date"
              value={search.from}
              onChange={(e) => updateSearch({ from: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">To date</label>
            <input
              type="date"
              value={search.to}
              onChange={(e) => updateSearch({ to: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Card / instrument</label>
            <select
              value={search.instrumentId}
              onChange={(e) => updateSearch({ instrumentId: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">All</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Category</label>
            <select
              value={search.categoryId}
              onChange={(e) => updateSearch({ categoryId: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div className="flex rounded-md border p-1 text-xs">
            <button
              onClick={() => setFilter("ALL")}
              className={`rounded px-3 py-1 ${filter === "ALL" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("INCOME")}
              className={`rounded px-3 py-1 ${filter === "INCOME" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              Income
            </button>
            <button
              onClick={() => setFilter("EXPENSE")}
              className={`rounded px-3 py-1 ${filter === "EXPENSE" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              Expense
            </button>
          </div>
          <p className="text-sm text-gray-500">
            {filteredTransactions.length} transaction{filteredTransactions.length === 1 ? "" : "s"} · Total: $
            {filteredTotal.toFixed(2)}
          </p>
        </div>
        {txnsLoading ? (
          <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
        ) : (
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
              {filteredTransactions.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="p-3">{formatDate(t.date)}</td>
                  <td className="p-3">{t.category.name}</td>
                  <td className="p-3">{t.instrument.name}</td>
                  <td className="p-3 text-gray-500">{t.notes || "—"}</td>
                  <td className="p-3 text-gray-500">{t.createdBy?.name ?? "—"}</td>
                  <td
                    className={`p-3 text-right font-medium ${
                      t.category.direction === "INCOME" ? "text-income-600" : "text-expense-600"
                    }`}
                  >
                    {t.category.direction === "INCOME" ? "+" : "-"}
                    {t.currency} {Number(t.amount).toFixed(2)}
                  </td>
                  <td className="space-x-3 p-3 text-right">
                    <button
                      onClick={() =>
                        setEditingTransaction({
                          id: t.id,
                          amount: t.amount,
                          currency: t.currency,
                          date: t.date,
                          notes: t.notes,
                          categoryId: t.category.id,
                          instrumentId: t.instrument.id,
                        })
                      }
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button onClick={() => handleDelete(t.id)} className="text-xs text-red-500 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-400">
                    {transactions.length === 0 ? "No transactions match your search." : `No ${filter.toLowerCase()} transactions in range.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
