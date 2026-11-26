"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DebtCategory, InstallmentFrequency, CURRENCIES } from "@/lib/enums";
import { getDefaultRate } from "@/lib/fx";
import { getTodayLocal } from "@/lib/formatDate";
import { debtToApproxUsd } from "@/lib/debtCalculations";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/formatDate";
import { monthlyOf, payoffPlan } from "@/lib/debtPayoff";

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
  const [extra, setExtra] = useState("");

  const [form, setForm] = useState({
    name: "",
    category: "CREDIT_CARD",
    currency: "USD",
    conversionRateToUsd: "",
    originalPrincipal: "",
    interestRate: "",
    startDate: getTodayLocal(),
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

  // The payoff plan (src/lib/debtPayoff.ts), in approx. USD: each debt's
  // balance, rate and own monthly payment, with and without the extra.
  const rateOf = (d: Debt) => (d.conversionRateToUsd ? Number(d.conversionRateToUsd) : null);
  const owing = activeDebts.filter((d) => d.balance > 0.005);
  const payoffDebts = owing.map((d) => ({
    id: d.id,
    name: d.name,
    balanceUsd: usdOf(d),
    ratePct: d.interestRate != null ? Number(d.interestRate) : null,
    monthlyUsd: debtToApproxUsd(monthlyOf(d.installmentAmount != null ? Number(d.installmentAmount) : null, d.installmentFrequency), d.currency, rateOf(d)),
  }));
  const extraUsd = Math.max(0, Number(extra.replace(/[,$\s]/g, "")) || 0);
  const startMonth = getTodayLocal().slice(0, 7);
  const plan = payoffPlan(payoffDebts, { strategy, extraMonthlyUsd: extraUsd, startMonth });
  const base = payoffPlan(payoffDebts, { strategy, startMonth });
  const other = payoffPlan(payoffDebts, { strategy: strategy === "avalanche" ? "snowball" : "avalanche", extraMonthlyUsd: extraUsd, startMonth });
  const noRate = owing.filter((d) => d.interestRate == null);
  const noPayment = owing.filter((d) => !d.installmentAmount);
  const monthName = (m: string) => formatDate(`${m}-01`, { month: "short", year: "numeric" });
  const span = (n: number) => (n < 12 ? `${n} month${n === 1 ? "" : "s"}` : `${Math.floor(n / 12)} yr${n % 12 ? ` ${n % 12} mo` : ""}`);
  const usd = (n: number) => money(n, "USD", 0);

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
            Converted using each debt&apos;s recorded rate where set, otherwise an approximate rate — each debt below still shows its real balance in its own currency.
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

      {owing.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg">Payoff plan</h2>
            <div className="flex rounded-md border p-1 text-xs" role="tablist" aria-label="Strategy">
              {(["avalanche", "snowball"] as const).map((k) => (
                <button key={k} role="tab" aria-selected={strategy === k} onClick={() => setStrategy(k)} className={`rounded px-2 py-1 ${strategy === k ? "bg-brand-600 text-white" : "text-gray-600"}`}>
                  {k === "avalanche" ? "Avalanche" : "Snowball"}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {strategy === "avalanche"
              ? "Pay each debt its own payment, and put anything extra toward the highest interest rate first — costs the least interest."
              : "Pay each debt its own payment, and put anything extra toward the smallest balance first — clears individual debts soonest."}{" "}
            When a debt is cleared, its payment moves on to the next one.
          </p>

          <div className="rounded-lg bg-paper px-3 py-3">
            {plan.done ? (
              <>
                <p className="text-xs uppercase tracking-wide text-gray-500">Debt-free by</p>
                <p className="font-display text-3xl">{monthName(plan.debtFreeMonth!)}</p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {span(plan.months!)} at {usd(plan.monthlyBudgetUsd)} a month · {usd(plan.interestUsd)} in interest
                </p>
                {extraUsd > 0 && base.done && (
                  <p className="mt-1 text-sm text-income-600">
                    The extra {usd(extraUsd)} a month gets you there {span(base.months! - plan.months!)} sooner and saves {usd(base.interestUsd - plan.interestUsd)} in interest.
                  </p>
                )}
                {extraUsd > 0 && !base.done && <p className="mt-1 text-sm text-income-600">Without the extra {usd(extraUsd)} a month, these would never be fully paid off.</p>}
                {other.done && Math.abs(other.interestUsd - plan.interestUsd) >= 1 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {strategy === "avalanche" ? "Snowball" : "Avalanche"} would cost {usd(Math.abs(other.interestUsd - plan.interestUsd))} {other.interestUsd > plan.interestUsd ? "more" : "less"} in interest
                    {other.months !== plan.months ? ` and finish ${span(Math.abs(other.months! - plan.months!))} ${other.months! > plan.months! ? "later" : "sooner"}` : ""}.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="font-medium text-expense-600">At {usd(plan.monthlyBudgetUsd)} a month, these debts are never fully paid off.</p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {plan.monthlyBudgetUsd < 0.5 ? "None of them has a payment set. " : "The payments don't keep up with the interest. "}Try an amount below to see what it would take.
                </p>
              </>
            )}
          </div>

          <div className="mt-3">
            <label className="text-sm font-medium" htmlFor="payoff-extra">
              Extra each month
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="flex w-32 items-center gap-1 rounded-md border px-2 focus-within:ring-2 focus-within:ring-brand-300">
                <span className="text-gray-400">$</span>
                <input id="payoff-extra" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0" className="w-full py-1.5 text-base tabular-nums outline-none" />
              </span>
              {[50, 100, 250, 500].map((c) => (
                <button key={c} type="button" onClick={() => setExtra(extraUsd === c ? "" : String(c))} className={`rounded-full border px-3 py-1 text-xs ${extraUsd === c ? "border-brand-600 bg-brand-50 text-brand-700" : "text-gray-600"}`}>
                  ${c}
                </button>
              ))}
            </div>
          </div>

          <ol className="mt-4 divide-y text-sm">
            {plan.rows.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">
                    {r.order}. {r.name}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {usd(r.startUsd)} owed{r.ratePct != null ? ` at ${r.ratePct.toFixed(1)}%` : ""} · {r.monthlyUsd > 0 ? `${usd(r.monthlyUsd)} a month` : "no payment set"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {r.clearedMonth ? (
                    <>
                      <span className="block tabular-nums">Cleared {monthName(r.clearedMonth)}</span>
                      <span className="block text-xs text-gray-500">{r.interestUsd >= 0.5 ? `${usd(r.interestUsd)} interest` : "no interest"}</span>
                    </>
                  ) : (
                    <span className="text-expense-600">Not cleared</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-gray-500">
            An estimate, in approximate US dollars: interest is added monthly on what&apos;s owed, and payments stay the same until everything is cleared.
            {noRate.length > 0 && ` No interest rate is recorded for ${noRate.map((d) => d.name).join(", ")}, so ${noRate.length === 1 ? "it is" : "they are"} treated as interest-free.`}
            {noPayment.length > 0 && ` ${noPayment.map((d) => d.name).join(", ")} ${noPayment.length === 1 ? "has" : "have"} no instalment set, so only extra money goes toward ${noPayment.length === 1 ? "it" : "them"}.`}
          </p>
        </div>
      )}
    </div>
  );
}
