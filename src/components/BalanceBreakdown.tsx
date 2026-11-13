"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/money";
import { formatDate, getTodayLocal } from "@/lib/formatDate";

type Item = { id: string; kind: "TRANSACTION" | "TRANSFER"; date: string; label: string; notes: string | null; amount: number };
type Data = { since: string | null; items: Item[]; count: number; total: number };

const SHOWN = 8;
const DAY = 86_400_000;
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

// How an account's balance is worked out: the starting balance, plus every
// transaction and transfer dated on or after its date. Shown under the
// balance, and live while the starting balance is edited, so it's clear why
// the balance isn't simply what was typed in.
export default function BalanceBreakdown({ instrumentId, since, opening, currency }: { instrumentId: string; since: string; opening: number | null; currency: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) return;
    let live = true;
    setData(null);
    fetch(`/api/instruments/${instrumentId}/balance?since=${since}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [instrumentId, since]);

  if (!data) return <p className="text-xs text-gray-400">Working out the balance…</p>;
  const today = getTodayLocal();
  const day = (d: string) => formatDate(d, { month: "short", day: "numeric", year: d.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" });
  const onStart = data.items.filter((i) => i.date === since);
  const future = data.items.filter((i) => i.date > today);
  const shown = all ? data.items : data.items.slice(0, SHOWN);
  const signed = (n: number) => `${n >= 0 ? "+" : "−"} ${money(Math.abs(n), currency)}`;

  return (
    <div className="space-y-2 text-xs text-gray-600">
      <p>
        {opening != null && !isNaN(opening) ? (
          <>
            <b className="tabular-nums">{money(opening, currency)}</b> as of {day(since)}
          </>
        ) : (
          <>Starting balance as of {day(since)}</>
        )}{" "}
        {data.count ? (
          <>
            <b className={`tabular-nums ${data.total >= 0 ? "text-income-600" : "text-expense-600"}`}>{signed(data.total)}</b> from {data.count} item{data.count === 1 ? "" : "s"} dated {day(since)} or later
            {opening != null && !isNaN(opening) && (
              <>
                {" "}= <b className="tabular-nums">{money(Math.round((opening + data.total) * 100) / 100, currency)}</b>
              </>
            )}
          </>
        ) : (
          <>— nothing dated {day(since)} or later, so the balance is the starting balance.</>
        )}
      </p>

      {onStart.length > 0 && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">
          {onStart.length} item{onStart.length === 1 ? " is" : "s are"} dated {day(since)}, the starting date itself, and {onStart.length === 1 ? "is" : "are"} counted on top. If{" "}
          {onStart.length === 1 ? "it's" : "they're"} already in the starting balance, set the date to {day(nextDay(since))}.
        </p>
      )}
      {future.length > 0 && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">
          {future.length} item{future.length === 1 ? " is" : "s are"} dated after today and counted already. Check {future.length === 1 ? "its date" : "their dates"}.
        </p>
      )}

      {data.count > 0 && (
        <ul className="divide-y rounded-md border bg-white">
          {shown.map((i) => (
            <li key={`${i.kind}:${i.id}`} className="flex items-baseline gap-2 px-2 py-1.5">
              <span className="min-w-[3.5rem] shrink-0 whitespace-nowrap tabular-nums text-gray-500">{day(i.date)}</span>
              <span className="min-w-0 flex-1 truncate">
                {i.label}
                {i.notes && <span className="text-gray-400"> · {i.notes}</span>}
                {i.date > today && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-900">future date</span>}
                {i.date === since && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-900">starting date</span>}
              </span>
              <span className={`shrink-0 tabular-nums ${i.amount >= 0 ? "text-income-600" : "text-gray-700"}`}>{signed(i.amount)}</span>
            </li>
          ))}
          {data.count > SHOWN && (
            <li className="px-2 py-1.5">
              <button onClick={() => setAll(!all)} className="text-brand-600 hover:underline">
                {all ? "Show fewer" : `Show all ${Math.min(data.count, data.items.length)}${data.count > data.items.length ? ` of ${data.count}` : ""}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
