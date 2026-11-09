"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/money";
import { getTodayLocal } from "@/lib/formatDate";

// Spending on each card and account this month or this year (approx USD),
// moved here from the dashboard.
type Slice = { id: string; name: string; total: number };

export default function CardUsage() {
  const [data, setData] = useState<{ monthly: { instrumentBreakdown: Slice[] }; ytd: { instrumentBreakdown: Slice[] } } | null>(null);
  const [period, setPeriod] = useState<"monthly" | "ytd">("monthly");
  useEffect(() => {
    const t = getTodayLocal();
    fetch(`/api/dashboard/summary?month=${Number(t.slice(5, 7))}&year=${Number(t.slice(0, 4))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data) return null;
  const rows = data[period].instrumentBreakdown;
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <section className="rounded-xl border bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-700">Spending by card and account</h2>
        <div className="flex rounded-lg border p-0.5 text-xs">
          {(
            [
              ["monthly", "This month"],
              ["ytd", "This year"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setPeriod(k)} className={`rounded-md px-2.5 py-1 ${period === k ? "bg-ink-900 text-white" : "text-gray-600"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="py-1.5">
            <span className="flex justify-between gap-3 text-sm">
              <span className="truncate">{r.name}</span>
              <span className="tabular-nums">{money(r.total, "USD", 0)}</span>
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-gray-100">
              <span className="block h-full rounded-full bg-brand-400" style={{ width: `${(r.total / max) * 100}%` }} />
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="py-3 text-sm text-gray-400">No spending yet.</li>}
      </ul>
      <p className="mt-1 text-xs text-gray-400">Approximate USD when rupees are included.</p>
    </section>
  );
}
