"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/money";
import { TRANSACTIONS_CHANGED } from "@/lib/events";

// How many months of essential spending the US bank cash covers, against a
// 3- or 6-month target, and what it takes to get there.

type Data = {
  targetMonths: number;
  cashUsd: number;
  accounts: string[];
  accountsWithoutBalance: string[];
  inrInIndia: number;
  monthsAveraged: number;
  essentialsMonthly: number;
  totalMonthly: number;
  monthsCovered: number | null;
  monthsCoveredAllSpending: number | null;
  target: number;
  gap: number;
  perPaycheck6: number;
  perPaycheck12: number;
};

const usd = (n: number) => money(n, "USD", 0);

export default function EmergencyFund() {
  const [target, setTargetState] = useState<3 | 6>(3);
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem("emergency-target") === "6") setTargetState(6);
    } catch {
      /* private mode */
    }
  }, []);
  const setTarget = (t: 3 | 6) => {
    setTargetState(t);
    try {
      localStorage.setItem("emergency-target", String(t));
    } catch {
      /* private mode */
    }
  };

  const load = useCallback(() => {
    fetch(`/api/dashboard/emergency?target=${target}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [target]);
  useEffect(() => {
    load();
    window.addEventListener(TRANSACTIONS_CHANGED, load);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, load);
  }, [load]);

  if (!data || data.monthsAveraged === 0) return null;
  if (!data.accounts.length) {
    return (
      <section className="rounded-xl border bg-white p-4 text-sm text-gray-600 shadow-sm">
        <h2 className="font-display text-lg text-ink-900">Emergency fund</h2>
        Set the balance on your US bank account (Accounts &amp; cards) to see how many months of expenses it would cover.
      </section>
    );
  }

  const covered = data.monthsCovered ?? 0;
  const pct = Math.min(100, (covered / 6) * 100);
  const done = data.gap <= 0.5;
  const tone = covered >= data.targetMonths ? "text-income-600" : covered >= 1 ? "text-amber-700" : "text-expense-600";
  const bar = covered >= data.targetMonths ? "bg-income-500" : covered >= 1 ? "bg-amber-500" : "bg-expense-500";

  return (
    <section aria-label="Emergency fund" className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg">Emergency fund</h2>
        <div className="flex rounded-lg border p-0.5 text-xs" role="tablist" aria-label="Target">
          {([3, 6] as const).map((t) => (
            <button key={t} role="tab" aria-selected={target === t} onClick={() => setTarget(t)} className={`rounded-md px-2.5 py-1 ${target === t ? "bg-ink-900 text-white" : "text-gray-600"}`}>
              {t} months
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-700">
        <span className={`font-display text-2xl tabular-nums ${tone}`}>{covered.toFixed(1)}</span> months of essentials covered
        <span className="text-gray-500">
          {" "}
          — {usd(data.cashUsd)} in the bank against about {usd(data.essentialsMonthly)}/mo of rent, EMIs, bills, groceries and gas.
        </span>
      </p>
      <div className="relative mt-3 h-2.5 rounded-full bg-gray-100">
        <div className={`absolute inset-y-0 left-0 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        {[3, 6].map((m) => (
          <span key={m} className="absolute -top-0.5 h-3.5 w-0.5 bg-ink-900/60" style={{ left: `calc(${(m / 6) * 100}% - 1px)` }} />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-gray-400">
        <span className="absolute left-0">0</span>
        <span className="absolute left-1/2 -translate-x-1/2">3 mo</span>
        <span className="absolute right-0">6 mo</span>
      </div>
      {done ? (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-income-600">
          You&apos;re at your {data.targetMonths}-month target ({usd(data.target)}). Money beyond it can work harder in investments.
        </p>
      ) : (
        <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm text-gray-700">
          {usd(data.gap)} more reaches {data.targetMonths} months ({usd(data.target)}): about <b className="tabular-nums">{usd(data.perPaycheck12)}</b> from each paycheck
          for a year, or <b className="tabular-nums">{usd(data.perPaycheck6)}</b> to get there in six months. A separate savings account keeps it from being spent.
        </p>
      )}
      <p className="mt-2 text-xs text-gray-400">
        Counted: {data.accounts.join(", ")}. Average of the last {data.monthsAveraged} full month{data.monthsAveraged === 1 ? "" : "s"}; all spending is about{" "}
        {usd(data.totalMonthly)}/mo ({data.monthsCoveredAllSpending ?? 0} months).
        {data.inrInIndia > 0 && ` ${money(data.inrInIndia, "INR", 0)} in India isn't counted.`}
        {data.accountsWithoutBalance.length > 0 && ` No balance set: ${data.accountsWithoutBalance.join(", ")}.`}
      </p>
    </section>
  );
}
