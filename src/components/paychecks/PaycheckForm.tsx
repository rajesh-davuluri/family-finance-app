"use client";

import { useState } from "react";
import { formatDate } from "@/lib/formatDate";

export type PaycheckDetail = { hoursPaid: number | null; periodStart: string | null; periodEnd: string | null };
type Bank = { id: string; name: string; currency: string };

const DAY = 86_400_000;
export const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const periodDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;
export function periodLabel(start: string, end: string) {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDate(start, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} – ${formatDate(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

// Add a paycheck (amount, day it landed, account, hours, pay period), or --
// with `transactionId` -- add or change the hours and pay period of one
// already recorded.
export default function PaycheckForm({
  banks,
  today,
  transactionId,
  amount: knownAmount,
  initial,
  suggested,
  onDone,
}: {
  banks: Bank[];
  today: string;
  transactionId?: string;
  amount?: number; // the paycheck being edited
  initial?: PaycheckDetail;
  suggested?: PaycheckDetail; // the next period and the usual hours, for a new paycheck
  onDone: (saved: boolean) => void;
}) {
  const adding = !transactionId;
  const start = initial ?? suggested;
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [instrumentId, setInstrumentId] = useState(banks[0]?.id ?? "");
  const [hours, setHours] = useState(start?.hoursPaid != null ? String(start.hoursPaid) : "");
  const [from, setFrom] = useState(start?.periodStart ?? "");
  const [to, setTo] = useState(start?.periodEnd ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (s: string) => Number(s.replace(/[,$\s]/g, ""));

  const pay = adding ? num(amount) : knownAmount ?? 0;
  const h = num(hours);
  const perHour = pay > 0 && h > 0 ? pay / h : null;
  const days = from && to && from <= to ? periodDays(from, to) : null;

  async function save(clear = false) {
    setErr(null);
    if (adding && !(num(amount) > 0)) return setErr("Enter the amount that was deposited.");
    if (adding && !instrumentId) return setErr("Pick the account it went into.");
    if (hours.trim() && !(h > 0)) return setErr("Hours paid should be a number.");
    if (!!from !== !!to) return setErr("Enter both days of the pay period.");
    if (from && to && from > to) return setErr("The pay period ends before it starts.");
    const detail = clear
      ? { hoursPaid: null, periodStart: null, periodEnd: null }
      : { hoursPaid: hours.trim() ? h : null, periodStart: from || null, periodEnd: to || null };
    setBusy(true);
    const res = await fetch(adding ? "/api/paychecks" : `/api/paychecks/${transactionId}`, {
      method: adding ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adding ? { date, amount: num(amount), instrumentId, detail } : detail),
    });
    setBusy(false);
    if (!res.ok) return setErr((await res.json().catch(() => null))?.error ?? "Couldn't save.");
    onDone(true);
  }

  const input = "w-full rounded-md border px-3 py-2 text-sm";
  const label = "mb-1 block text-xs text-gray-500";
  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <h2 className="font-medium">{adding ? "Add a paycheck" : "Hours and pay period"}</h2>
      {adding && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label>
            <span className={label}>Amount deposited ($)</span>
            <input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="3,100.00" className={input} />
          </label>
          <label>
            <span className={label}>Paid on</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className={label}>Into</span>
            <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} className={input}>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="col-span-2 sm:col-span-1">
          <span className={label}>Hours paid</span>
          <input inputMode="decimal" autoFocus={!adding} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="80" className={input} />
        </label>
        <label>
          <span className={label}>Pay period from</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              // Two weeks, unless an end is already set after it.
              if (e.target.value && (!to || to < e.target.value)) setTo(shiftDay(e.target.value, 13));
            }}
            className={input}
          />
        </label>
        <label>
          <span className={label}>to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
      </div>
      <p className="text-xs text-gray-500">
        {days ? `${days}-day pay period` : "The pay period is the dates the hours were worked."}
        {perHour != null && <> · ${perHour.toFixed(2)} an hour take-home</>}
        {adding && " · It's saved as Salary income, so it shows in your pay cycles. If a bank statement brings the same deposit in later, the import flags it as already recorded."}
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => save()} disabled={busy} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Saving…" : adding ? "Add paycheck" : "Save"}
        </button>
        {!adding && initial && (initial.hoursPaid != null || initial.periodStart) && (
          <button onClick={() => save(true)} disabled={busy} className="rounded-md border px-3 py-2 text-sm text-red-600">
            Remove
          </button>
        )}
        <button onClick={() => onDone(false)} className="rounded-md border px-3 py-2 text-sm text-gray-600">
          Cancel
        </button>
      </div>
    </div>
  );
}
