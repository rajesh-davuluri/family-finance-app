"use client";

import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import AddTransactionModal, { EditableTransaction } from "@/components/AddTransactionModal";
import DuplicateReview from "@/components/DuplicateReview";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import { SOURCE_LABELS, sourceOf } from "@/lib/lastActivity";
import { money } from "@/lib/money";
import { TRANSACTIONS_CHANGED } from "@/lib/events";

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
  source?: string | null;
  recurringTemplateId?: string | null;
  importBatchId?: string | null;
  importBatch?: { fileName: string } | null;
};

const EMPTY_SEARCH = { from: "", to: "", instrumentId: "", categoryId: "" };
const PAGE = 50;

// "Thu, Nov 5" -- the day headers in the phone list.
function dayLabel(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: y === new Date().getFullYear() ? undefined : "numeric" });
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [txnsLoading, setTxnsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server thinks the new transaction is already recorded.
  const [duplicate, setDuplicate] = useState<{
    date: string;
    amount: number;
    currency: string;
    notes: string | null;
    instrumentName: string;
    reason: string;
  } | null>(null);
  // Bumped whenever transactions change, so the duplicate review re-checks.
  const [changes, setChanges] = useState(0);
  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  // Text search over what's loaded (merchant/notes, category, account, amount).
  const [query, setQuery] = useState("");
  // On a phone the date/account/category filters fold away.
  const [showFilters, setShowFilters] = useState(false);
  // Rows shown; "Show more" adds another PAGE.
  const [visible, setVisible] = useState(PAGE);

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
    setChanges((c) => c + 1);
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

  // A transaction added from the bottom bar's ＋ shows up here straight away.
  useEffect(() => {
    const h = () => loadTransactions();
    window.addEventListener(TRANSACTIONS_CHANGED, h);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function updateSearch(patch: Partial<typeof search>) {
    const next = { ...search, ...patch };
    setSearch(next);
    loadTransactions(next);
  }

  function clearSearch() {
    setSearch(EMPTY_SEARCH);
    loadTransactions(EMPTY_SEARCH);
  }

  async function handleSubmit(e: React.FormEvent, allowDuplicate = false) {
    e.preventDefault();
    setError(null);
    setDuplicate(null);
    if (!form.categoryId || !form.instrumentId) {
      setError("Add a category and a payment instrument first (see the Categories / Instruments pages).");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        amount: parseFloat(form.amount),
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      if (res.status === 409 && body.duplicate) {
        setDuplicate(body.duplicate);
        return;
      }
      setError(typeof body.error === "string" ? body.error : "Couldn't save that transaction.");
      return;
    }
    setForm((f) => ({ ...f, amount: "", notes: "" }));
    loadTransactions();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this transaction? This can't be undone.")) return;
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    setEditingTransaction(null);
    loadTransactions();
  }

  function edit(t: Transaction) {
    setEditingTransaction({
      id: t.id,
      amount: t.amount,
      currency: t.currency,
      date: t.date,
      notes: t.notes,
      categoryId: t.category.id,
      instrumentId: t.instrument.id,
    });
  }

  function handleEditSuccess() {
    setEditingTransaction(null);
    loadTransactions();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  const noSetupYet = categories.length === 0 || instruments.length === 0;

  const q = query.trim().toLowerCase();
  const filteredTransactions = transactions
    .filter((t) => filter === "ALL" || t.category.direction === filter)
    .filter(
      (t) =>
        !q ||
        (t.notes ?? "").toLowerCase().includes(q) ||
        t.category.name.toLowerCase().includes(q) ||
        t.instrument.name.toLowerCase().includes(q) ||
        Number(t.amount).toFixed(2).includes(q),
    );
  // Money in and money out, per currency -- adding them together (or rupees
  // to dollars) would give a number that means nothing.
  const totals = new Map<string, { in: number; out: number }>();
  for (const t of filteredTransactions) {
    const x = totals.get(t.currency) ?? { in: 0, out: 0 };
    if (t.category.direction === "INCOME") x.in += Number(t.amount);
    else x.out += Number(t.amount);
    totals.set(t.currency, x);
  }
  const searchActive = search.from || search.to || search.instrumentId || search.categoryId;
  const activeFilters = [search.from || search.to, search.instrumentId, search.categoryId].filter(Boolean).length;
  const shown = filteredTransactions.slice(0, visible);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Transactions</h1>

      <DuplicateReview refreshKey={changes} onRemoved={() => loadTransactions()} />

      <AddTransactionModal
        open={!!editingTransaction}
        onClose={() => setEditingTransaction(null)}
        onSuccess={handleEditSuccess}
        editingTransaction={editingTransaction}
        onDelete={handleDelete}
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

      {/* On a phone the bottom bar's ＋ adds a transaction; this inline form is for wider screens. */}
      <form onSubmit={handleSubmit} className="hidden grid-cols-1 gap-3 rounded-lg border bg-white p-4 lg:grid lg:grid-cols-6">
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
        {duplicate && (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-6"
            role="alert"
          >
            <span className="font-medium">This looks like it&rsquo;s already recorded:</span>{" "}
            {formatDate(duplicate.date)} · {duplicate.currency} {duplicate.amount.toFixed(2)}
            {duplicate.notes ? ` · “${duplicate.notes}”` : ""} · {duplicate.instrumentName}{" "}
            <span className="text-xs text-amber-800">({duplicate.reason})</span>
            <span className="ml-2 inline-flex gap-2">
              <button
                type="button"
                onClick={(e) => handleSubmit(e as unknown as React.FormEvent, true)}
                className="rounded-md border border-amber-400 bg-white px-2 py-0.5 text-xs hover:bg-amber-100"
              >
                Add anyway
              </button>
              <button type="button" onClick={() => setDuplicate(null)} className="text-xs hover:underline">
                Don&rsquo;t add
              </button>
            </span>
          </div>
        )}
      </form>

      {/* Search criteria */}
      <div className="rounded-lg border bg-white p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisible(PAGE);
            }}
            placeholder="Search merchant, note, category, amount"
            aria-label="Search transactions"
            className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={`shrink-0 rounded-md border px-3 py-2 text-sm sm:hidden ${activeFilters ? "border-brand-400 bg-brand-50 text-brand-700" : "text-gray-600"}`}
          >
            Filters{activeFilters ? ` · ${activeFilters}` : ""}
          </button>
          {searchActive && (
            <button onClick={clearSearch} className="hidden shrink-0 text-xs text-brand-600 hover:underline sm:block">
              Clear filters
            </button>
          )}
        </div>
        <div className={`mt-3 grid-cols-1 gap-3 sm:grid sm:grid-cols-4 ${showFilters ? "grid" : "hidden"}`}>
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
          {searchActive && (
            <button onClick={clearSearch} className="text-left text-sm text-brand-600 hover:underline sm:hidden">
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div className="flex rounded-md border p-1 text-xs">
            <button
              onClick={() => setFilter("ALL")}
              className={`rounded px-4 py-1.5 sm:px-3 sm:py-1 ${filter === "ALL" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("INCOME")}
              className={`rounded px-4 py-1.5 sm:px-3 sm:py-1 ${filter === "INCOME" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              Income
            </button>
            <button
              onClick={() => setFilter("EXPENSE")}
              className={`rounded px-4 py-1.5 sm:px-3 sm:py-1 ${filter === "EXPENSE" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              Expense
            </button>
          </div>
<div className="flex flex-col gap-0.5 text-sm text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
            <span>
              {filteredTransactions.length} transaction{filteredTransactions.length === 1 ? "" : "s"}
            </span>
            {[...totals.entries()].map(([c, x]) => (
              <span key={c} className="whitespace-nowrap tabular-nums">
                <span className="hidden sm:inline">· </span>
                {x.in > 0 && <span className="text-income-600">in {money(x.in, c)}</span>}
                {x.in > 0 && x.out > 0 && " "}
                {x.out > 0 && <span className="text-expense-600">out {money(x.out, c)}</span>}
              </span>
            ))}
          </div>
        </div>
        {txnsLoading ? (
          <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
        ) : (
          <>
          {/* Phone: grouped by day, one line per transaction; tap to edit or delete. */}
          <ul className="lg:hidden">
            {shown.map((t, i) => {
              const day = t.date.slice(0, 10);
              const newDay = i === 0 || shown[i - 1].date.slice(0, 10) !== day;
              const income = t.category.direction === "INCOME";
              return (
                <li key={t.id}>
                  {newDay && <p className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-10 border-b bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500">{dayLabel(t.date)}</p>}
                  <button onClick={() => edit(t)} className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left active:bg-gray-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-ink-900">{t.notes || t.category.name}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {t.notes ? `${t.category.name} · ` : ""}
                        {t.instrument.name}
                        {sourceOf(t) !== "MANUAL" ? ` · ${SOURCE_LABELS[sourceOf(t)]}` : ""}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[15px] font-medium tabular-nums ${income ? "text-income-600" : "text-ink-900"}`}>
                      {income ? "+" : ""}
                      {money(Number(t.amount), t.currency)}
                    </span>
                  </button>
                </li>
              );
            })}
            {filteredTransactions.length === 0 && (
              <li className="p-6 text-center text-sm text-gray-400">
                {transactions.length === 0 ? "No transactions match your search." : "Nothing matches."}
              </li>
            )}
          </ul>
          <table className="hidden w-full text-sm lg:table">
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
              {shown.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="p-3">{formatDate(t.date)}</td>
                  <td className="p-3">{t.category.name}</td>
                  <td className="p-3">{t.instrument.name}</td>
                  <td className="p-3 text-gray-500">{t.notes || "—"}</td>
                  <td className="p-3 text-gray-500">
                    {t.createdBy?.name ?? "—"}
                    {sourceOf(t) !== "MANUAL" && (
                      <span className="block text-xs text-gray-400">{SOURCE_LABELS[sourceOf(t)]}</span>
                    )}
                  </td>
                  <td
                    className={`p-3 text-right font-medium ${
                      t.category.direction === "INCOME" ? "text-income-600" : "text-expense-600"
                    }`}
                  >
                    {t.category.direction === "INCOME" ? "+" : "−"}
                    {money(Number(t.amount), t.currency)}
                  </td>
                  <td className="space-x-3 p-3 text-right">
                    <button onClick={() => edit(t)} className="text-xs text-brand-600 hover:underline">
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
          {filteredTransactions.length > visible && (
            <button
              onClick={() => setVisible((v) => v + PAGE)}
              className="w-full border-t px-3 py-3 text-sm font-medium text-brand-700 hover:bg-gray-50"
            >
              Show {Math.min(PAGE, filteredTransactions.length - visible)} more of {filteredTransactions.length - visible}
            </button>
          )}
          </>
        )}
      </div>
    </div>
  );
}
