"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { debtToApproxUsd, convertToDebtCurrency } from "@/lib/debtCalculations";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import { CURRENCIES } from "@/lib/enums";

type Payment = { id: string; amount: string; currency: string; paymentDate: string; note: string | null };
type DebtDetail = {
  id: string;
  name: string;
  category: string;
  currency: string;
  conversionRateToUsd: string | null;
  originalPrincipal: string;
  interestRate: string | null;
  installmentAmount: string | null;
  installmentFrequency: string | null;
  status: string;
  notes: string | null;
  balance: number;
  payments: Payment[];
  owner: { id: string; name: string } | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  CREDIT_CARD: "Credit Card",
  AUTO_LOAN: "Auto Loan",
  PERSONAL_LOAN: "Personal Loan",
  MEDICAL: "Medical",
  OTHER: "Other",
};

export default function DebtDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [debt, setDebt] = useState<DebtDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ amount: "", currency: "USD", paymentDate: getTodayLocal(), note: "" });
  const [submitting, setSubmitting] = useState(false);

  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/debts/${id}`);
    if (res.ok) {
      const d = await res.json();
      setDebt(d);
      // Default the payment form's currency to the debt's own currency the
      // first time it loads, so the common case (paying in the same
      // currency the debt was taken in) needs no extra click.
      setForm((f) => (f.amount === "" ? { ...f, currency: d.currency } : f));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleLogPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch(`/api/debts/${id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: parseFloat(form.amount),
        currency: form.currency,
        paymentDate: form.paymentDate,
        note: form.note || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't log that payment.");
      return;
    }
    setForm((f) => ({ ...f, amount: "", note: "" }));
    load();
  }

  async function handleDeletePayment(paymentId: string) {
    if (!confirm("Delete this payment?")) return;
    await fetch(`/api/debts/${id}/payments/${paymentId}`, { method: "DELETE" });
    load();
  }

  async function handleDeleteDebt() {
    if (!confirm(`Delete "${debt?.name}" and all its payment history? This can't be undone.`)) return;
    await fetch(`/api/debts/${id}`, { method: "DELETE" });
    router.push("/debts");
  }

  async function handleCloseDebt() {
    await fetch(`/api/debts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CLOSED" }),
    });
    load();
  }

  async function handleSaveRate() {
    const rate = parseFloat(rateInput);
    if (!rate || rate <= 0) return;
    await fetch(`/api/debts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversionRateToUsd: rate }),
    });
    setEditingRate(false);
    load();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;
  if (!debt) return <p className="text-sm text-red-600">Debt not found.</p>;

  const pct = Math.min(100, Math.round(((Number(debt.originalPrincipal) - debt.balance) / Number(debt.originalPrincipal)) * 100));
  const isForeign = debt.currency !== "USD";
  const rate = debt.conversionRateToUsd ? Number(debt.conversionRateToUsd) : null;
  const approxUsd = isForeign ? debtToApproxUsd(debt.balance, debt.currency, rate) : null;
  const debtInfo = { currency: debt.currency, conversionRateToUsd: rate };

  return (
    <div className="space-y-6">
      <Link href="/debts" className="text-sm text-brand-600 hover:underline">
        ← Back to Debts
      </Link>

      <div className="rounded-lg border bg-white p-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">{debt.name}</h1>
            <p className="text-sm text-gray-500">
              {CATEGORY_LABELS[debt.category]}
              {debt.owner ? ` · ${debt.owner.name}` : " · Shared"}
              {debt.interestRate ? ` · ${Number(debt.interestRate).toFixed(1)}% APR` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className={`font-display text-2xl font-semibold ${debt.status === "PAID_OFF" ? "text-income-600" : "text-expense-600"}`}>
              {debt.currency} {debt.balance.toFixed(2)}
            </p>
            <p className="text-xs text-gray-400">
              of {debt.currency} {Number(debt.originalPrincipal).toFixed(2)}
            </p>
            {isForeign && approxUsd !== null && <p className="text-xs text-gray-400">≈ ${approxUsd.toFixed(2)}</p>}
          </div>
        </div>
        <div className="mt-3 h-2 w-full rounded-full bg-gray-100">
          <div className={`h-2 rounded-full ${debt.status === "PAID_OFF" ? "bg-income-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-gray-400">{pct}% paid off</p>
        {debt.notes && <p className="mt-3 text-sm text-gray-600">{debt.notes}</p>}

        {isForeign && (
          <div className="mt-3 rounded-md bg-gray-50 p-3 text-xs text-gray-500">
            {editingRate ? (
              <div className="flex items-center gap-2">
                <span>1 {debt.currency} =</span>
                <input
                  type="number"
                  step="0.000001"
                  min="0.000001"
                  autoFocus
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  className="w-28 rounded border px-2 py-1 text-xs"
                />
                <span>USD</span>
                <button onClick={handleSaveRate} className="text-brand-600 hover:underline">
                  Save
                </button>
                <button onClick={() => setEditingRate(false)} className="text-gray-400 hover:underline">
                  Cancel
                </button>
              </div>
            ) : (
              <span>
                Conversion rate: {rate ? `1 ${debt.currency} = $${rate}` : "using app default (not set for this debt)"} ·{" "}
                <button
                  onClick={() => {
                    setRateInput(rate ? String(rate) : "");
                    setEditingRate(true);
                  }}
                  className="text-brand-600 hover:underline"
                >
                  {rate ? "Edit" : "Set the actual rate"}
                </button>
              </span>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-3">
          {debt.status === "ACTIVE" && (
            <button onClick={handleCloseDebt} className="text-xs text-gray-500 hover:underline">
              Mark as closed
            </button>
          )}
          <button onClick={handleDeleteDebt} className="text-xs text-red-500 hover:underline">
            Delete debt
          </button>
        </div>
      </div>

      {debt.status === "ACTIVE" && (
        <form onSubmit={handleLogPayment} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-5">
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="Payment amount"
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
                {c === debt.currency ? " (debt's currency)" : ""}
              </option>
            ))}
          </select>
          <input
            type="date"
            required
            value={form.paymentDate}
            onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            placeholder="Note (optional)"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? "Logging..." : "Log payment"}
          </button>
          {error && <p className="text-sm text-red-600 sm:col-span-5">{error}</p>}
          {form.currency !== debt.currency && (
            <p className="text-xs text-gray-400 sm:col-span-5">
              You're paying in {form.currency}, this debt is tracked in {debt.currency} — it'll be converted automatically using{" "}
              {rate ? "this debt's own rate" : "the app's default rate"} when calculating the balance.
            </p>
          )}
        </form>
      )}

      <div className="rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="p-3">Date</th>
              <th className="p-3">Note</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {debt.payments.map((p) => {
              const paymentIsForeign = p.currency !== debt.currency;
              const converted = paymentIsForeign ? convertToDebtCurrency(Number(p.amount), p.currency, debtInfo) : null;
              return (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3">{formatDate(p.paymentDate)}</td>
                  <td className="p-3 text-gray-500">{p.note || "—"}</td>
                  <td className="p-3 text-right font-medium text-income-600">
                    {p.currency} {Number(p.amount).toFixed(2)}
                    {converted !== null && (
                      <span className="ml-1 text-xs font-normal text-gray-400">
                        (≈ {debt.currency} {converted.toFixed(2)})
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDeletePayment(p.id)} className="text-xs text-red-500 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {debt.payments.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-gray-400">
                  No payments logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
