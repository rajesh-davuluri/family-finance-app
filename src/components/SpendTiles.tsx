"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/money";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import type { GroupSpend } from "@/lib/categorySpend";

// Groceries, food and car gas: this month so far (against last month by the
// same day) and this year (with the monthly average).

const ICON: Record<string, string> = { groceries: "🛒", food: "🍽️", gas: "⛽" };

export default function SpendTiles() {
  const [data, setData] = useState<{ today: string; mixedCurrency: boolean; groups: GroupSpend[] } | null>(null);

  const load = useCallback(() => {
    fetch("/api/dashboard/category-spend", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(TRANSACTIONS_CHANGED, load);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, load);
  }, [load]);

  if (!data) return null;
  const month = new Date(`${data.today}T12:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = data.today.slice(0, 4);

  return (
    <section aria-label="Everyday spending" className="space-y-1.5">
      {/* Phone: one compact card, a row per category. */}
      <div className="rounded-xl border bg-white px-4 py-3 shadow-sm sm:hidden">
        <div className="mb-1 grid grid-cols-[1fr_auto_auto] gap-x-4 text-[11px] uppercase tracking-wide text-gray-500">
          <span>Everyday spending</span>
          <span className="w-20 text-right">{month} so far</span>
          <span className="w-20 text-right">{year} so far</span>
        </div>
        <ul className="divide-y">
          {data.groups.map((g) => {
            const diff = g.mtd - g.lastMonthToDate;
            return (
              <li key={g.key} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 py-2">
                <span className="min-w-0">
                  <span className="block text-sm">
                    <span aria-hidden>{ICON[g.key]} </span>
                    {g.label}
                  </span>
                  {g.categories.length > 0 && (g.mtd > 0 || g.lastMonthToDate > 0) && Math.abs(diff) >= 0.5 && (
                    <span className={`block text-[11px] ${diff > 0 ? "text-expense-600" : "text-income-600"}`}>
                      {diff > 0 ? "▲" : "▼"} {money(Math.abs(diff), "USD", 0)} vs last month
                    </span>
                  )}
                </span>
                {g.categories.length === 0 ? (
                  <span className="col-span-2 text-right text-xs text-gray-400">no category</span>
                ) : (
                  <>
                    <span className="w-20 text-right font-display text-lg tabular-nums">{money(g.mtd, "USD", 0)}</span>
                    <span className="w-20 text-right tabular-nums text-gray-600">{money(g.ytd, "USD", 0)}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="hidden grid-cols-3 gap-3 sm:grid">
        {data.groups.map((g) => {
          const diff = g.mtd - g.lastMonthToDate;
          const compare =
            g.lastMonthToDate === 0 && g.mtd === 0
              ? null
              : Math.abs(diff) < 0.5
                ? { text: "same as last month so far", cls: "text-gray-500" }
                : { text: `${money(Math.abs(diff), "USD", 0)} ${diff > 0 ? "more" : "less"} than last month so far`, cls: diff > 0 ? "text-expense-600" : "text-income-600" };
          return (
            <div key={g.key} className="rounded-xl border bg-white p-3 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                <span aria-hidden>{ICON[g.key]} </span>
                {g.label}
              </p>
              {g.categories.length === 0 ? (
                <p className="mt-2 text-sm text-gray-400">No “{g.label}” category yet.</p>
              ) : (
                <>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <div>
                      <p className="font-display text-2xl tabular-nums">{money(g.mtd, "USD", 0)}</p>
                      <p className="text-[11px] text-gray-500">{month} so far</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg tabular-nums text-gray-700">{money(g.ytd, "USD", 0)}</p>
                      <p className="text-[11px] text-gray-500">{year} so far</p>
                    </div>
                  </div>
                  <div className="mt-2 border-t pt-1.5 text-xs">
                    {compare && <p className={compare.cls}>{compare.text}</p>}
                    <p className="text-gray-500">
                      Last month {money(g.lastMonth, "USD", 0)} · avg {money(g.monthlyAverage, "USD", 0)}/mo
                    </p>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {data.mixedCurrency && <p className="px-1 text-[11px] text-gray-400">Rupee spending included at an approximate rate, in USD.</p>}
    </section>
  );
}
