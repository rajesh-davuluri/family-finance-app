"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/money";
import { getTodayLocal } from "@/lib/formatDate";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import type { Drill, Slice } from "@/components/dashboard/DrillSheet";
import { ChangeBadge, DailySpendLine, IncomeSplitGauge } from "@/components/dashboard/Insights";

// "Am I on track?" and "Where is the money going?": income, spending and
// what's kept for this month, last month or this year; the month's pace
// against the usual; the biggest categories with their budgets; and twelve
// months of income against spending. Every number opens what's behind it.

type Summary = { income: number; expense: number; net: number; savings: number; fixed?: number; needs?: number; expenseBreakdown: Slice[]; incomeBreakdown: Slice[] };
type SummaryResponse = { month: number; year: number; monthly: Summary; ytd: Summary; monthRange: { from: string; to: string }; ytdRange: { from: string; to: string } };
type Month = { year: number; month: number; isCurrent: boolean; spent: number; income: number };
type Budget = { categoryId: string; monthlyLimit: string; spent: number };
type Period = "month" | "last" | "year";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const usd = (n: number) => money(n, "USD", 0);

export default function Overview({ onDrill, children }: { onDrill: (d: Drill) => void; children?: React.ReactNode }) {
  const [period, setPeriodState] = useState<Period>("month");
  const [cur, setCur] = useState<SummaryResponse | null>(null);
  const [last, setLast] = useState<SummaryResponse | null>(null);
  const [months, setMonths] = useState<Month[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  // Last month up to the same day, for the "vs last month" badges, and spending by day.
  const [lastToDate, setLastToDate] = useState<SummaryResponse | null>(null);
  const [daily, setDaily] = useState<{ daysInMonth: number; thisMonth: number[]; lastMonth: number[] } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("dashboard-period");
      if (saved === "month" || saved === "last" || saved === "year") setPeriodState(saved);
    } catch {
      /* private mode */
    }
  }, []);
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    try {
      localStorage.setItem("dashboard-period", p);
    } catch {
      /* private mode */
    }
  };

  const load = useCallback(() => {
    const today = getTodayLocal();
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const get = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    get(`/api/dashboard/summary?month=${m}&year=${y}`).then(setCur).catch(() => setCur(null));
    get(`/api/dashboard/summary?month=${pm}&year=${py}`).then(setLast).catch(() => setLast(null));
    get("/api/dashboard/monthly-spending?months=13").then((j) => setMonths(j?.months ?? [])).catch(() => setMonths([]));
    get("/api/budgets").then((j) => setBudgets(Array.isArray(j) ? j : [])).catch(() => setBudgets([]));
    get(`/api/dashboard/summary?month=${pm}&year=${py}&upto=${Number(today.slice(8, 10))}`).then(setLastToDate).catch(() => setLastToDate(null));
    get("/api/dashboard/daily-spend").then(setDaily).catch(() => setDaily(null));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(TRANSACTIONS_CHANGED, load);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, load);
  }, [load]);

  const view = useMemo(() => {
    if (!cur) return null;
    if (period === "year") return { s: cur.ytd, range: cur.ytdRange, label: `${cur.year} so far` };
    if (period === "last" && last) return { s: last.monthly, range: last.monthRange, label: `${LONG[last.month - 1]} ${last.year}` };
    return { s: cur.monthly, range: cur.monthRange, label: `${LONG[cur.month - 1]} so far` };
  }, [cur, last, period]);

  if (!cur || !view) return <div className="h-64 animate-pulse rounded-xl bg-white/60" aria-hidden />;
  const { s, range } = view;
  const kept = Math.round((s.income - s.expense) * 100) / 100;
  // Badges only for this month, against last month by the same day.
  const before = period === "month" ? lastToDate?.monthly : null;
  const rate = s.income > 0 ? Math.round((kept / s.income) * 100) : null;

  // Pace: this month's spending projected to month end, against the average
  // of the last six full months. Bills and EMIs (rent, car loan, utilities)
  // are paid once, early in the month, so they count as they are; only the
  // everyday spending is projected at its daily rate so far.
  const today = getTodayLocal();
  const day = Number(today.slice(8, 10));
  const dim = new Date(Date.UTC(cur.year, cur.month, 0)).getUTCDate();
  const full = months.filter((x) => !x.isCurrent).slice(-6);
  const avg = full.length ? full.reduce((t, x) => t + x.spent, 0) / full.length : null;
  const fixed = Math.min(cur.monthly.fixed ?? 0, cur.monthly.expense);
  const projected = fixed + ((cur.monthly.expense - fixed) / Math.max(day, 1)) * dim;
  const pace = period === "month" && avg != null && avg > 0 && day >= 5 ? { projected, avg, diff: projected - avg } : null;

  const budgetBy = new Map(budgets.map((b) => [b.categoryId, Number(b.monthlyLimit)]));
  const top = s.expenseBreakdown.slice(0, 6);
  const maxCat = Math.max(...top.map((c) => Math.max(c.total, period === "month" ? budgetBy.get(c.id) ?? 0 : 0)), 1);

  const trend = months.slice(-12);
  const maxTrend = Math.max(...trend.map((x) => Math.max(x.income, x.spent)), 1);
  const openMonth = async (x: Month) => {
    const r = await fetch(`/api/dashboard/summary?month=${x.month}&year=${x.year}`).then((res) => (res.ok ? res.json() : null));
    if (r) onDrill({ kind: "categories", title: `Spent in ${LONG[x.month - 1]} ${x.year}`, from: r.monthRange.from, to: r.monthRange.to, items: r.monthly.expenseBreakdown });
  };

  return (
    <>
      <section aria-label="This period" className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-lg">{view.label}</h2>
          <div className="flex self-start rounded-lg border p-0.5 text-xs sm:self-auto" role="tablist">
            {(
              [
                ["month", "This month"],
                ["last", "Last month"],
                ["year", "This year"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={period === k}
                onClick={() => setPeriod(k)}
                className={`rounded-md px-2.5 py-1.5 ${period === k ? "bg-ink-900 text-white" : "text-gray-600"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onDrill({ kind: "categories", title: "Income", subtitle: view.label, from: range.from, to: range.to, items: s.incomeBreakdown })}
            className="rounded-lg bg-paper px-3 py-2.5 text-left active:opacity-80"
          >
            <span className="block text-xs text-gray-500">Income ›</span>
            <span className="font-display block text-xl tabular-nums text-income-600 sm:text-2xl">{usd(s.income)}</span>
            <ChangeBadge now={s.income} before={before?.income} upIsGood />
          </button>
          <button
            onClick={() => onDrill({ kind: "categories", title: "Spent", subtitle: view.label, from: range.from, to: range.to, items: s.expenseBreakdown })}
            className="rounded-lg bg-paper px-3 py-2.5 text-left active:opacity-80"
          >
            <span className="block text-xs text-gray-500">Spent ›</span>
            <span className="font-display block text-xl tabular-nums sm:text-2xl">{usd(s.expense)}</span>
            <ChangeBadge now={s.expense} before={before?.expense} upIsGood={false} />
          </button>
          <div className="rounded-lg bg-paper px-3 py-2.5">
            <span className="block text-xs text-gray-500">Kept{rate != null ? ` · ${rate}%` : ""}</span>
            <span className={`font-display block text-xl tabular-nums sm:text-2xl ${kept < 0 ? "text-expense-600" : ""}`}>{usd(kept)}</span>
            <ChangeBadge now={kept} before={before ? before.income - before.expense : null} upIsGood />
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {s.savings > 0.5 && <>{usd(s.savings)} of it went to savings and investments. </>}
          {rate != null && (rate >= 20 ? "A healthy share kept." : rate >= 0 ? "Aim to keep 20% or more of income." : "Spending is above income.")}
          {before && " Badges compare with last month by the same day."}
        </p>

        <IncomeSplitGauge income={s.income} needs={s.needs ?? 0} spent={s.expense} />

        {pace && (
          <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${pace.diff > pace.avg * 0.1 ? "bg-red-50 text-expense-600" : pace.diff < -pace.avg * 0.1 ? "bg-green-50 text-income-600" : "bg-gray-50 text-gray-700"}`}>
            On pace to spend <b className="tabular-nums">{usd(pace.projected)}</b> this month —{" "}
            {Math.abs(pace.diff) < pace.avg * 0.05 ? "about your usual" : `${usd(Math.abs(pace.diff))} ${pace.diff > 0 ? "more" : "less"} than your usual`}{" "}
            <span className="whitespace-nowrap">({usd(pace.avg)}/mo)</span>.
            {fixed > 0.5 && <span className="block text-xs opacity-80">Bills and EMIs ({usd(fixed)}) counted once; everyday spending projected at its pace so far.</span>}
          </p>
        )}

        {period === "month" && daily && <DailySpendLine thisMonth={daily.thisMonth} lastMonth={daily.lastMonth} daysInMonth={daily.daysInMonth} />}

        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Where it went</h3>
            {period === "month" && budgets.length > 0 && (
              <Link href="/budgets" className="text-xs text-brand-700 underline">
                Budgets
              </Link>
            )}
          </div>
          <ul>
            {top.map((c) => {
              const limit = period === "month" ? budgetBy.get(c.id) : undefined;
              const over = limit != null && c.total > limit;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => onDrill({ kind: "transactions", title: c.name, subtitle: view.label, from: range.from, to: range.to, categoryId: c.id })}
                    className="block w-full py-1.5 text-left active:opacity-70"
                  >
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">{c.name}</span>
                      <span className={`shrink-0 tabular-nums ${over ? "font-medium text-expense-600" : ""}`}>
                        {usd(c.total)}
                        {limit != null && <span className="text-xs text-gray-400"> / {usd(limit)}</span>}
                      </span>
                    </span>
                    <span className="relative mt-1 block h-2 rounded-full bg-gray-100">
                      <span
                        className={`absolute inset-y-0 left-0 rounded-full ${over ? "bg-expense-500" : "bg-brand-400"}`}
                        style={{ width: `${Math.min(100, (c.total / maxCat) * 100)}%` }}
                      />
                      {limit != null && (
                        <span className="absolute -top-0.5 h-3 w-0.5 bg-ink-900" style={{ left: `${Math.min(100, (limit / maxCat) * 100)}%` }} title="Budget" />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {top.length === 0 && <li className="py-3 text-sm text-gray-400">No spending in this period.</li>}
          </ul>
          {s.expenseBreakdown.length > top.length && (
            <button
              onClick={() => onDrill({ kind: "categories", title: "Spent", subtitle: view.label, from: range.from, to: range.to, items: s.expenseBreakdown })}
              className="mt-1 text-sm text-brand-700 underline"
            >
              All {s.expenseBreakdown.length} categories
            </button>
          )}
        </div>
      </section>

      {children}

      {trend.length > 1 && (
        <section aria-label="Last 12 months" className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="font-display text-lg">Last 12 months</h2>
            <span className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-income-500" /> Income
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-brand-400" /> Spent
              </span>
            </span>
          </div>
          <div className="flex h-36 items-end gap-1 sm:gap-2">
            {trend.map((x) => (
              <button
                key={`${x.year}-${x.month}`}
                onClick={() => openMonth(x)}
                className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                aria-label={`${LONG[x.month - 1]} ${x.year}: income ${usd(x.income)}, spent ${usd(x.spent)}`}
              >
                <span className="flex h-full w-full items-end justify-center gap-px">
                  <span className="w-1/2 max-w-3 rounded-t-sm bg-income-500/80" style={{ height: `${(x.income / maxTrend) * 100}%` }} />
                  <span className={`w-1/2 max-w-3 rounded-t-sm ${x.isCurrent ? "bg-brand-300" : "bg-brand-400"} group-active:bg-brand-600`} style={{ height: `${(x.spent / maxTrend) * 100}%` }} />
                </span>
                <span className={`text-[10px] ${x.isCurrent ? "font-semibold text-ink-900" : "text-gray-400"}`}>{MONTHS[x.month - 1].slice(0, 1)}</span>
              </button>
            ))}
          </div>
          {avg != null && (
            <p className="mt-2 text-xs text-gray-500">
              Usual spending {usd(avg)}/mo over the last {full.length} full months. Tap a month to see where it went.
            </p>
          )}
        </section>
      )}
    </>
  );
}
