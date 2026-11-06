"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/formatDate";
import { FREQUENCY_LABELS, FrequentCharge, RecurringBill } from "@/lib/recurringDetect";

// Recurring bills found in the household's own transactions, and how much of
// each paycheck they need. Bills not seen lately can be marked "still paying"
// (remembered in this browser) to keep them in the set-aside.

const STILL_PAYING_KEY = "ff.recurring.stillPaying";

function usd(n: number, cents = false) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

function amountText(amount: number, currency: string) {
  return currency === "USD"
    ? usd(amount, true)
    : `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(d: string) {
  return formatDate(d, { month: "short", day: "numeric", year: "numeric" });
}

function readStillPaying(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STILL_PAYING_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export default function DetectedBills() {
  const [data, setData] = useState<{ today: string; bills: RecurringBill[]; frequent: FrequentCharge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stillPaying, setStillPaying] = useState<Set<string>>(new Set());

  useEffect(() => {
    setStillPaying(readStillPaying());
    fetch("/api/recurring/detected")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : "Couldn't look for recurring bills.");
        setData(body);
      })
      .catch((e) => setError(e.message));
  }, []);

  function toggleStillPaying(key: string) {
    const next = new Set(stillPaying);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setStillPaying(next);
    try {
      localStorage.setItem(STILL_PAYING_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // Private window etc.: the choice just won't be remembered.
    }
  }

  const { current, stopped, perPaycheck, perMonth } = useMemo(() => {
    const bills = data?.bills ?? [];
    const current = bills.filter((b) => b.status !== "STOPPED");
    const stopped = bills.filter((b) => b.status === "STOPPED");
    // A stopped bill the person still pays counts at its usual rate.
    const counted = [...current, ...stopped.filter((b) => stillPaying.has(b.key))];
    const rate = (b: RecurringBill, days: number) => (b.status === "STOPPED" ? (b.usd * days) / b.intervalDays : days === 14 ? b.perPaycheckUsd : b.perMonthUsd);
    return {
      current,
      stopped,
      perPaycheck: counted.reduce((s, b) => s + rate(b, 14), 0),
      perMonth: counted.reduce((s, b) => s + rate(b, 30.44), 0),
    };
  }, [data, stillPaying]);

  if (error) return <p className="rounded-lg border bg-white p-4 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="rounded-lg border bg-white p-4 text-sm text-gray-400">Looking for recurring bills…</p>;

  const counted = current.length + stopped.filter((b) => stillPaying.has(b.key)).length;

  return (
    <section className="space-y-4 rounded-lg border border-l-4 border-l-brand-500 bg-white p-4">
      <div>
        <h2 className="font-medium">Bills found in your history</h2>
        <p className="text-sm text-gray-500">
          Payments that repeat on a schedule — rent, loan EMIs, insurance, subscriptions — found in your last year of
          transactions. Nothing to set up; this updates as you add transactions.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Set aside from each paycheck" value={usd(perPaycheck)} sub={`for ${counted} regular ${counted === 1 ? "bill" : "bills"}`} strong />
        <Tile label="Per month" value={usd(perMonth)} sub="the same bills, monthly" />
        <Tile
          label="Not seen lately"
          value={String(stopped.length)}
          sub={stopped.length ? "below — tick any you still pay" : "every bill is up to date"}
        />
      </div>

      {data.frequent.map((f) => (
        <p key={f.key} className="rounded-md border border-expense-500/40 bg-expense-500/5 px-3 py-2 text-sm text-expense-600">
          <strong>{f.label}</strong> charged {amountText(f.amount, f.currency)} {f.count} times between {day(f.firstDate)} and{" "}
          {day(f.lastDate)}. Worth checking this isn&rsquo;t a billing error or a subscription you meant to cancel.
        </p>
      ))}

      {current.length === 0 ? (
        <p className="text-sm text-gray-400">No regular bills found yet — they show up after a few payments.</p>
      ) : (
        <BillTable bills={current} today={data.today} />
      )}

      {stopped.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium text-gray-700">Not seen lately</h3>
          <p className="mb-2 text-xs text-gray-500">
            These used to repeat but haven&rsquo;t been recorded recently. If you still pay one, tick it to keep it in the
            set-aside — and add the missing payments so they&rsquo;re counted.
          </p>
          <BillTable bills={stopped} today={data.today} stillPaying={stillPaying} onToggle={toggleStillPaying} />
        </div>
      )}
      <p className="text-xs text-gray-400">
        Per paycheck = the bill&rsquo;s amount × 14 days ÷ how often it comes. Amounts in approximate USD for the totals.
      </p>
    </section>
  );
}

function Tile({ label, value, sub, strong }: { label: string; value: string; sub: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${strong ? "bg-brand-50" : ""}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-display text-xl font-semibold tabular-nums text-ink-900">{value}</p>
      <p className="text-xs text-gray-500">{sub}</p>
    </div>
  );
}

function BillTable({
  bills,
  today,
  stillPaying,
  onToggle,
}: {
  bills: RecurringBill[];
  today: string;
  stillPaying?: Set<string>;
  onToggle?: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr className="border-b">
            {onToggle && <th className="w-10 py-1.5 pr-2 font-normal">Still paying</th>}
            <th className="py-1.5 pr-3 font-normal">Bill</th>
            <th className="py-1.5 pr-3 font-normal">How often</th>
            <th className="py-1.5 pr-3 text-right font-normal">Amount</th>
            <th className="hidden py-1.5 pr-3 font-normal sm:table-cell">Last paid</th>
            <th className="py-1.5 pr-3 font-normal">{onToggle ? "Was due" : "Next"}</th>
            <th className="py-1.5 text-right font-normal">Per paycheck</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => {
            const ticked = stillPaying?.has(b.key) ?? false;
            const perPaycheck = b.status === "STOPPED" ? (ticked ? (b.usd * 14) / b.intervalDays : 0) : b.perPaycheckUsd;
            return (
              <tr key={b.key} className={`border-b last:border-0 ${onToggle && !ticked ? "text-gray-500" : ""}`}>
                {onToggle && (
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={() => onToggle(b.key)}
                      aria-label={`I still pay ${b.label}`}
                      className="h-4 w-4"
                    />
                  </td>
                )}
                <td className="py-1.5 pr-3">
                  {b.label}
                  <span className="block text-xs text-gray-400">
                    {b.categoryName} · {b.instrumentName} · {b.count} payments
                  </span>
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3">{FREQUENCY_LABELS[b.frequency]}</td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">
                  {amountText(b.amount, b.currency)}
                  {b.previousAmount !== null && (
                    <span className="block text-xs text-gray-400">was {amountText(b.previousAmount, b.currency)}</span>
                  )}
                </td>
                <td className="hidden whitespace-nowrap py-1.5 pr-3 sm:table-cell">{day(b.lastDate)}</td>
                <td className="whitespace-nowrap py-1.5 pr-3">
                  {day(b.nextDate)}
                  {b.status === "LATE" && b.nextDate < today && (
                    <span className="block text-xs text-expense-600">not recorded yet</span>
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{perPaycheck ? usd(perPaycheck) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
