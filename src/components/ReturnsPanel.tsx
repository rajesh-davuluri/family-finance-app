"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/money";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import { returnText, type ReturnStatus } from "@/lib/returns";
import type { EditableTransaction } from "@/components/AddTransactionModal";

// Returns on the Transactions page: what's on its way back, return windows
// still open, and refunds in the last month -- with what's still owed back.
// Tapping one opens the purchase. Nothing shows when there's nothing to show.

type Item = {
  id: string;
  date: string;
  notes: string | null;
  amount: number;
  currency: string;
  instrumentId: string;
  instrumentName: string;
  categoryId: string;
  returnBy: string | null;
  returnState: string | null;
  name: string;
  status: ReturnStatus | null;
};

const RECENT_DAYS = 30;
const tone = (s: ReturnStatus) =>
  s.kind === "LATE" || s.kind === "SHORT" ? "bg-expense-500" : s.kind === "WINDOW_SOON" ? "bg-amber-500" : s.kind === "REFUNDED" ? "bg-income-500" : "bg-gray-400";

export default function ReturnsPanel({ today, onEdit }: { today: string; onEdit: (t: EditableTransaction) => void }) {
  const [data, setData] = useState<{ items: Item[]; owedUsd: number } | null>(null);
  const load = useCallback(() => {
    fetch("/api/returns", { cache: "no-store" })
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
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const shown = data.items.filter((i) => {
    const s = i.status;
    if (!s || s.kind === "KEPT" || s.kind === "WINDOW_PASSED") return false;
    if (s.kind === "REFUNDED") return s.on >= since;
    return true;
  });
  if (!shown.length) return null;
  const order = { LATE: 0, SHORT: 1, WINDOW_SOON: 2, AWAITING: 3, WINDOW: 4, REFUNDED: 5 } as Record<string, number>;
  shown.sort((a, b) => order[a.status!.kind] - order[b.status!.kind]);

  return (
    <section aria-label="Returns" className="rounded-lg border bg-white p-3 sm:p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-gray-700">Returns · {shown.length}</h2>
        {data.owedUsd > 0 && <p className="text-xs text-gray-600">Refunds still owed: <span className="font-medium text-ink-900">{money(data.owedUsd, "USD")}</span></p>}
      </div>
      <ul className="divide-y">
        {shown.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() =>
                onEdit({ id: i.id, amount: i.amount, currency: i.currency, date: i.date, notes: i.notes, categoryId: i.categoryId, instrumentId: i.instrumentId, returnBy: i.returnBy, returnState: i.returnState })
              }
              className="flex w-full items-center gap-2 py-2 text-left text-sm active:bg-gray-50"
            >
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${tone(i.status!)}`} />
              <span className="min-w-0 flex-1">
                {returnText(i.name, i.status!, (n) => money(n, i.currency))}
                <span className="block text-xs text-gray-500">
                  {money(i.amount, i.currency)} · {i.instrumentName}
                </span>
              </span>
              <span aria-hidden className="text-gray-400">›</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
