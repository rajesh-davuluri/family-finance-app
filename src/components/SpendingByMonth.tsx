"use client";

import { useEffect, useState } from "react";
import CollapsibleSection from "@/components/CollapsibleSection";

// Dashboard "Spending by month": the last 12 months side by side -- spent,
// received, net, change vs the previous month and the biggest category --
// with a thin bar per month so the trend reads at a glance. One measure, one
// hue (the app's expense color); the numbers stay in text ink.

type MonthRow = {
  year: number;
  month: number;
  isCurrent: boolean;
  spent: number;
  income: number;
  net: number;
  transactions: number;
  topCategory: { name: string; amount: number } | null;
  changePct: number | null;
};

function usd(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function monthLabel(r: MonthRow) {
  return new Date(r.year, r.month - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export default function SpendingByMonth() {
  const [rows, setRows] = useState<MonthRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard/monthly-spending?months=12")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRows(d.months))
      .catch(() => setFailed(true));
  }, []);

  // Average over complete months only -- the current month is partial.
  const complete = rows?.filter((r) => !r.isCurrent && r.transactions > 0) ?? [];
  const average = complete.length ? complete.reduce((s, r) => s + r.spent, 0) / complete.length : null;
  const total = rows?.reduce((s, r) => s + r.spent, 0) ?? 0;
  const max = Math.max(1, ...(rows ?? []).map((r) => r.spent));
  const newestFirst = rows ? [...rows].reverse() : [];

  return (
    <CollapsibleSection
      storageKey="dashboard-spending-by-month"
      title="Spending by month"
      summary={average !== null ? `avg ${usd(average)}/month` : undefined}
    >
      {failed ? (
        <p className="text-sm text-red-600">Couldn&apos;t load monthly spending.</p>
      ) : rows === null ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : total === 0 ? (
        <p className="text-sm text-gray-500">No spending recorded in the last 12 months yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2 pr-3">Month</th>
                <th className="py-2 pr-3">Spent</th>
                <th className="hidden py-2 pr-3 text-right sm:table-cell">Received</th>
                <th className="py-2 pr-3 text-right">Net</th>
                <th className="py-2 pr-3 text-right">vs prev.</th>
                <th className="hidden py-2 md:table-cell">Top category</th>
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((r) => (
                <tr key={`${r.year}-${r.month}`} className="border-b last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3">
                    {monthLabel(r)}
                    {r.isCurrent && <span className="block text-xs text-gray-400">so far</span>}
                  </td>
                  <td className="py-2 pr-3" title={`${monthLabel(r)}: ${usd(r.spent)} across ${r.transactions} transactions`}>
                    <div className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-right font-medium tabular-nums">{usd(r.spent)}</span>
                      <span className="hidden h-4 flex-1 items-center sm:flex" aria-hidden>
                        <span
                          className="block h-1.5 rounded-r bg-expense-500"
                          style={{ width: `${Math.max(r.spent > 0 ? 2 : 0, (r.spent / max) * 100)}%` }}
                        />
                      </span>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap py-2 pr-3 text-right tabular-nums text-gray-600 sm:table-cell">{usd(r.income)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-gray-600">
                    {r.net < 0 ? "−" : ""}
                    {usd(Math.abs(r.net))}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-gray-500">
                    {r.changePct === null ? "—" : `${r.changePct > 0 ? "↑" : r.changePct < 0 ? "↓" : ""} ${Math.abs(r.changePct)}%`}
                  </td>
                  <td className="hidden py-2 text-gray-600 md:table-cell">
                    {r.topCategory ? (
                      <>
                        {r.topCategory.name} <span className="text-xs text-gray-400">{usd(r.topCategory.amount)}</span>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t text-xs text-gray-500">
                <td className="pt-2 pr-3">12 months</td>
                <td className="pt-2 pr-3 font-medium text-gray-700">{usd(total)} spent</td>
                <td colSpan={4} className="pt-2 text-right">
                  Approximate USD<span className="hidden sm:inline"> · current month is partial and left out of the average</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}
