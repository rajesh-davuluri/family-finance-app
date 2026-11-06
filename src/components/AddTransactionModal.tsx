"use client";

import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import { formatDate, getTodayLocal } from "@/lib/formatDate";

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE" };
type Instrument = { id: string; name: string; currency: string; archived: boolean };
type DuplicateInfo = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  notes: string | null;
  categoryName: string;
  instrumentName: string;
  source: string;
  reason: string;
};
const SOURCE_WORDS: Record<string, string> = {
  IMPORTED: "imported from a statement",
  EMAIL: "from an email alert",
  TELEGRAM: "sent from Telegram",
  RECURRING: "from a recurring template",
  MANUAL: "added by hand",
};

export type EditableTransaction = {
  id: string;
  amount: string | number;
  currency: string;
  date: string;
  notes: string | null;
  categoryId: string;
  instrumentId: string;
};

export default function AddTransactionModal({
  open,
  onClose,
  onSuccess,
  editingTransaction,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // When provided, the modal edits this transaction (PATCH) instead of
  // creating a new one (POST). Everything else about the form is identical.
  editingTransaction?: EditableTransaction | null;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // An existing transaction this one looks like a copy of (from the server's duplicate check).
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    amount: "",
    currency: "USD",
    date: getTodayLocal(),
    notes: "",
    categoryId: "",
    instrumentId: "",
  });

  const isEditing = !!editingTransaction;

  // Load fresh options each time the modal opens, in case a category or
  // instrument was added/archived since the last time it was open. Prefills
  // from editingTransaction when editing, otherwise defaults to sensible
  // first options for a new transaction.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDuplicate(null);
    setLoading(true);
    Promise.all([fetch("/api/categories"), fetch("/api/instruments")]).then(async ([catRes, instRes]) => {
      const cats = await catRes.json();
      const insts = await instRes.json();
      setCategories(cats);
      setInstruments(insts);
      if (editingTransaction) {
        setForm({
          amount: String(editingTransaction.amount),
          currency: editingTransaction.currency,
          date: editingTransaction.date.slice(0, 10),
          notes: editingTransaction.notes ?? "",
          categoryId: editingTransaction.categoryId,
          instrumentId: editingTransaction.instrumentId,
        });
      } else {
        setForm((f) => ({
          ...f,
          categoryId: cats[0]?.id || "",
          instrumentId: insts.find((i: Instrument) => !i.archived)?.id || "",
        }));
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingTransaction?.id]);

  async function handleSubmit(e: React.FormEvent, allowDuplicate = false) {
    e.preventDefault();
    setError(null);
    setDuplicate(null);
    if (!form.categoryId || !form.instrumentId) {
      setError("Add a category and a payment instrument first (see the Categories / Instruments pages).");
      return;
    }
    setSubmitting(true);
    const res = await fetch(isEditing ? `/api/transactions/${editingTransaction!.id}` : "/api/transactions", {
      method: isEditing ? "PATCH" : "POST",
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
      setError(
        typeof body.error === "string" ? body.error : `Couldn't ${isEditing ? "save" : "add"} that transaction.`,
      );
      return;
    }
    if (!isEditing) setForm((f) => ({ ...f, amount: "", notes: "" }));
    setDuplicate(null);
    onSuccess();
  }

  if (!open) return null;

  const noSetupYet = !loading && (categories.length === 0 || instruments.length === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEditing ? "Edit Transaction" : "Add Transaction"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <>
            {noSetupYet && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                You need at least one category and one payment instrument before adding transactions — set those up
                on the Categories / Instruments pages first.
              </div>
            )}
            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
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
                className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
              >
                {instruments
                  .filter((i) => !i.archived || i.id === editingTransaction?.instrumentId)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.archived ? " (archived)" : ""}
                    </option>
                  ))}
              </select>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="rounded-md border px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Notes (optional)"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="rounded-md border px-3 py-2 text-sm"
              />
              {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
              {duplicate && (
                <div
                  className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2"
                  role="alert"
                >
                  <p className="font-medium">This looks like it&rsquo;s already recorded:</p>
                  <p className="mt-1">
                    {formatDate(duplicate.date)} · {duplicate.currency} {duplicate.amount.toFixed(2)}
                    {duplicate.notes ? ` · “${duplicate.notes}”` : ""} · {duplicate.categoryName} ·{" "}
                    {duplicate.instrumentName}
                    {SOURCE_WORDS[duplicate.source] ? ` (${SOURCE_WORDS[duplicate.source]})` : ""}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">{duplicate.reason}.</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={(e) => handleSubmit(e as unknown as React.FormEvent, true)}
                      className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs hover:bg-amber-100"
                    >
                      Add anyway
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-md px-3 py-1 text-xs text-amber-900 hover:underline"
                    >
                      Don&rsquo;t add
                    </button>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || noSetupYet}
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {submitting ? "Saving..." : isEditing ? "Save Changes" : "Add Transaction"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
