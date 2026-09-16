"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DebtCategory, InstallmentFrequency, CURRENCIES } from "@/lib/enums";
import { getDefaultRate } from "@/lib/fx";
import { debtToApproxUsd } from "@/lib/debtCalculations";

type Debt = {
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
  balance: number;
  totalPaid: number;
  owner: { id: string; name: string } | null;
};

type Member = { id: string; name: string };

const CATEGORY_LABELS: Record<string, string> = {
  CREDIT_CARD: "Credit Card",
  AUTO_LOAN: "Auto Loan",
  PERSONAL_LOAN: "Personal Loan",
  MEDICAL: "Medical",
  OTHER: "Other",
};

const FREQ_LABELS: Record<string, string> = { WEEKLY: "Weekly", BIWEEKLY: "Biweekly", MONTHLY: "Monthly" };

export default function DebtsPage() {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<"avalanche" | "snowball">("avalanche");

  const [form, setForm] = useState({
    name: "",
    category: "CREDIT_CARD",
    currency: "USD",
    conversionRateToUsd: "",
    originalPrincipal: "",
    interestRate: "",
    startDate: new Date().toISOString().slice(0, 10),
    installmentAmount: "",
    installmentFrequency: "",
    ownerId: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    const [debtsRes, householdRes] = await Promise.all([fetch("/api/debts"), fetch("/api/household")]);
    setDebts(await debtsRes.json());
    const household = await householdRes.json();
    setMembers(household?.users ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function handleCurrencyChange(currency: string) {
    // Pre-fill a sensible starting rate when switching to a non-USD
    // currency -- the person can overwrite it with the actual rate they got.
    setForm({
      ...form,
      currency,
      conversionRateToUsd: currency === "USD" ? "" : String(getDefaultRate(currency)),
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        currency: form.currency,
        conversionRateToUsd: form.currency !== "USD" && form.conversionRateToUsd ? parseFloat(form.conversionRateToUsd) : undefined,
        originalPrincipal: parseFloat(form.originalPrincipal),
        interestRate: form.interestRate ? parseFloat(form.interestRate) : undefined,
        startDate: form.startDate,
        installmentAmount: form.installmentAmount ? parseFloat(form.installmentAmount) : undefined,
        installmentFrequency: form.installmentFrequency || undefined,
        ownerId: form.ownerId || undefined,
        notes: form.notes || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't add that debt.");
      return;
    }
    setForm({ ...form, name: "", originalPrincipal: "", interestRate: "", installmentAmount: "", installmentFrequency: "", notes: "" });
    setShowForm(false);
    load();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  const activeDebts = debts.filter((d) => d.status === "ACTIVE");

  // Debts can be in different currencies (e.g. a USD credit card alongside
  // an INR personal loan) -- "Total owed" and the snowball ordering need an
  // apples-to-apples comparison. Each debt's own recorded conversion rate is
  // used when set (the actual rate at the time it was taken out), falling
  // back to the app's generic approximate rate otherwise. Every individual
  // debt's own balance is always shown in ITS OWN currency, never converted,
  // everywhere else on this page.
  const usdOf = (d: Debt) => debtToApproxUsd(d.balance, d.currency, d.conversionRateToUsd ? Number(d.conversionRateToUsd) : null);

  const totalOwedUsd = activeDebts.reduce((sum, d) => sum + usdOf(d), 0);

  const ordered =
    strategy === "avalanche"
      ? [...activeDebts].sort((a, b) => Number(b.interestRate ?? 0) - Number(a.interestRate ?? 0))
      : [...activeDebts].sort((a, b) => usdOf(a) - usdOf(b));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Debts</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showForm ? "Cancel" : "Add debt"}
        </button>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <p className="text-sm text-gray-500">Total owed (active debts, approx. USD)</p>
        <p className="mt-1 font-display text-2xl font-semibold text-expense-600">${totalOwedUsd.toFixed(2)}</p>
        {debts.some((d) => d.currency !== "USD") && (
          <p className="mt-1 text-xs text-gray-400">
            Converted using each debt's recorded rate where set, otherwise an approximate rate — each debt below still shows its real balance in its own currency.
          </p>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-3">
          <input
            required
            placeholder="Name (e.g. Chase Sapphire)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
          />
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {DebtCategory.options.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="Original principal"
            value={form.originalPrincipal}
            onChange={(e) => setForm({ ...form, originalPrincipal: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <select
            value={form.currency}
            onChange={(e) => handleCurrencyChange(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {form.currency !== "USD" && (
            <input
              type="number"
              step="0.000001"
              min="0.000001"
              placeholder={`Conversion rate to USD (1 ${form.currency} = ? USD)`}
              value={form.conversionRateToUsd}
              onChange={(e) => setForm({ ...form, conversionRateToUsd: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
            />
          )}
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="Interest rate % (optional)"
            value={form.interestRate}
            onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            type="date"
            required
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            type="number"
            step="0.01"
            min="0.01"
            placeholder="Installment amount (optional)"
            value={form.installmentAmount}
            onChange={(e) => setForm({ ...form, installmentAmount: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <select
            value={form.installmentFrequency}
            onChange={(e) => setForm({ ...form, installmentFrequency: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="">No fixed plan</option>
            {InstallmentFrequency.options.map((f) => (
              <option key={f} value={f}>
                {FREQ_LABELS[f]}
              </option>
            ))}
          </select>
          <select
            value={form.ownerId}
            onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Shared / joint debt</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
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
            {submitting ? "Adding..." : "Add debt"}
          </button>
          {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
        </form>
      )}

      <div className="space-y-3">
        {debts.length === 0 && <p className="text-sm text-gray-400">No debts tracked yet.</p>}
        {debts.map((d) => {
          const pct = Math.min(100, Math.round((d.totalPaid / Number(d.originalPrincipal)) * 100));
          return (
            <Link
              key={d.id}
              href={`/debts/${d.id}`}
              className="block rounded-lg border bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-xs text-gray-500">
                    {CATEGORY_LABELS[d.category]}
                    {d.owner ? ` · ${d.owner.name}` : " · Shared"}
                    {d.status !== "ACTIVE" && ` · ${d.status === "PAID_OFF" ? "Paid off" : "Closed"}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-lg font-semibold ${d.status === "PAID_OFF" ? "text-income-600" : "text-expense-600"}`}>
                    {d.currency} {d.balance.toFixed(2)}
                  </p>
                  {d.currency !== "USD" && <p className="text-xs text-gray-400">≈ ${usdOf(d).toFixed(2)}</p>}
                </div>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
                <div
                  className={`h-2 rounded-full ${d.status === "PAID_OFF" ? "bg-income-500" : "bg-brand-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">{pct}% paid off</p>
            </Link>
          );
        })}
      </div>

      {activeDebts.length > 1 && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">Payoff strategy</h2>
            <div className="flex rounded-md border p-1 text-xs">
              <button
                onClick={() => setStrategy("avalanche")}
                className={`rounded px-2 py-1 ${strategy === "avalanche" ? "bg-brand-600 text-white" : "text-gray-600"}`}
              >
                Avalanche
              </button>
              <button
                onClick={() => setStrategy("snowball")}
                className={`rounded px-2 py-1 ${strategy === "snowball" ? "bg-brand-600 text-white" : "text-gray-600"}`}
              >
                Snowball
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {strategy === "avalanche"
              ? "Pay minimums on everything, put extra toward the highest interest rate first — saves the most money overall."
              : "Pay minimums on everything, put extra toward the smallest balance first (compared in approx. USD across currencies) — clears individual debts faster."}
          </p>
          <ol className="space-y-2">
            {ordered.map((d, i) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span>
                  {i + 1}. {d.name} {d.interestRate ? `(${Number(d.interestRate).toFixed(1)}%)` : ""}
                </span>
                <span className="font-medium">
                  {d.currency} {d.balance.toFixed(2)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
