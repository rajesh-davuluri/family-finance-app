"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/money";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import { formatDate } from "@/lib/formatDate";

// The emergency fund: money set aside (typed in, or a bank account named
// "Emergency...") against months of essential spending, with the target in
// months saved for the household (6 by default) and the plan to reach it.
// A typed-in fund grows by "Add money" (who put it in, kept as history);
// the pace of the last few months says when the target is reached.

type HistoryItem = { id: string; date: string; amountUsd: number; label: string; note: string | null; by: string | null };

type Data = {
  targetMonths: number;
  source: "account" | "entered" | "none";
  cashUsd: number;
  fundAccounts: string[];
  checkingUsd: number;
  inrInIndia: number;
  monthsAveraged: number;
  essentialsMonthly: number;
  totalMonthly: number;
  monthsCovered: number | null;
  target: number;
  gap: number;
  perPaycheck6: number;
  perPaycheck12: number;
  startingUsd: number;
  addedThisMonth: number;
  perMonth: number;
  paceMonths: number;
  monthsToTarget: number | null;
  reachBy: string | null;
  history: HistoryItem[];
  entryCount: number;
  byPerson: { name: string; net: number }[];
  members: { id: string; name: string }[];
  me: string;
  today: string;
};


const usd = (n: number) => money(n, "USD", 0);
const monthName = (ym: string) => formatDate(`${ym}-01`, { month: "short", year: "numeric" });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
const TARGETS = [3, 6, 12] as const;

export default function EmergencyFund() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<null | "IN" | "OUT">(null);
  const [form, setForm] = useState({ amount: "", by: "", date: "", note: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/dashboard/emergency", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(TRANSACTIONS_CHANGED, load);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, load);
  }, [load]);

  async function save(body: { fundUsd?: number | null; targetMonths?: number }) {
    setBusy(true);
    await fetch("/api/dashboard/emergency", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    setEditing(false);
    load();
  }

  function openEntry(direction: "IN" | "OUT") {
    if (!data) return;
    setForm({ amount: "", by: direction === "IN" ? data.me : "", date: data.today, note: "" });
    setError(null);
    setEntry(direction);
  }

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(form.amount.replace(/[,$\s]/g, ""));
    if (!entry || !Number.isFinite(v) || v <= 0) {
      setError("Enter an amount.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/dashboard/emergency/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountUsd: v, direction: entry, date: form.date, byUserId: form.by || null, note: form.note.trim() || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Couldn't save that.");
      return;
    }
    setEntry(null);
    load();
  }

  async function removeEntry(item: HistoryItem) {
    if (!confirm(`Remove ${signed(item.amountUsd)} on ${formatDate(item.date)}? The fund's total changes by that much.`)) return;
    setBusy(true);
    await fetch(`/api/dashboard/emergency/entries/${item.id}`, { method: "DELETE" });
    setBusy(false);
    load();
  }

  if (!data || data.monthsAveraged === 0) return null;
  const covered = data.monthsCovered ?? 0;
  const scale = Math.max(data.targetMonths, 6);
  const pct = Math.min(100, (covered / scale) * 100);
  const done = data.gap <= 0.5;
  const tone = covered >= data.targetMonths ? "text-income-600" : covered >= data.targetMonths / 2 ? "text-amber-700" : "text-expense-600";
  const bar = covered >= data.targetMonths ? "bg-income-500" : covered >= data.targetMonths / 2 ? "bg-amber-500" : "bg-expense-500";
  const askAmount = data.source === "none" || editing;

  return (
    <section aria-label="Emergency fund" className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg">Emergency fund</h2>
        <div className="flex rounded-lg border p-0.5 text-xs" role="tablist" aria-label="Target">
          {TARGETS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={data.targetMonths === t}
              disabled={busy}
              onClick={() => save({ targetMonths: t })}
              className={`rounded-md px-2.5 py-1 ${data.targetMonths === t ? "bg-ink-900 text-white" : "text-gray-600"}`}
            >
              {t} months
            </button>
          ))}
        </div>
      </div>

      {askAmount ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(amount.replace(/[,$\s]/g, ""));
            if (Number.isFinite(v) && v >= 0) save({ fundUsd: v });
          }}
          className="space-y-2 text-sm"
        >
          <label className="block text-gray-700" htmlFor="ef-amount">
            {editing ? "How much is in the fund now, in total?" : "How much do you have set aside for emergencies?"}
          </label>
          <div className="flex gap-2">
            <input
              id="ef-amount"
              inputMode="decimal"
              autoFocus={editing}
              placeholder="3000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-40 rounded-md border px-3 py-2 tabular-nums"
            />
            <button disabled={busy || !amount.trim()} className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white disabled:opacity-50">
              Save
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="rounded-md border px-3 py-2 text-gray-600">
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {editing
              ? "Use this only to correct the total. To put money in, use Add money so it shows in the history."
              : "After this, use Add money each time you put more in. A bank account here named “Emergency…” is used instead, automatically."}
          </p>
        </form>
      ) : (
        <>
          <p className="text-sm text-gray-700">
            <span className={`font-display text-2xl tabular-nums ${tone}`}>{covered.toFixed(1)}</span> of {data.targetMonths} months of essentials covered
            <span className="text-gray-500">
              {" "}
              — {usd(data.cashUsd)} set aside against about {usd(data.essentialsMonthly)}/mo of rent, EMIs, bills, groceries and gas.
            </span>{" "}
            {data.source === "entered" && (
              <button
                onClick={() => {
                  setAmount(String(data.cashUsd));
                  setEditing(true);
                }}
                className="text-brand-700 underline"
              >
                Correct total
              </button>
            )}
          </p>
          <div className="relative mt-3 h-2.5 rounded-full bg-gray-100">
            <div className={`absolute inset-y-0 left-0 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
            <span className="absolute -top-0.5 h-3.5 w-0.5 bg-ink-900/70" style={{ left: `calc(${(data.targetMonths / scale) * 100}% - 1px)` }} title="Target" />
          </div>
          <div className="relative mt-1 h-4 text-[11px] text-gray-400">
            <span className="absolute left-0">0</span>
            <span className="absolute -translate-x-1/2 font-medium text-ink-900" style={{ left: `${(data.targetMonths / scale) * 100}%` }}>
              {data.targetMonths === scale ? "" : `${data.targetMonths} mo target`}
            </span>
            <span className="absolute right-0">{data.targetMonths === scale ? `${scale} mo target` : `${scale} mo`}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-paper px-3 py-2">
              <div className="text-xs text-gray-500">Added this month</div>
              <div className={`font-display text-lg tabular-nums ${data.addedThisMonth > 0.5 ? "text-income-600" : data.addedThisMonth < -0.5 ? "text-expense-600" : "text-gray-700"}`}>
                {Math.abs(data.addedThisMonth) < 0.5 ? usd(0) : signed(data.addedThisMonth)}
              </div>
            </div>
            <div className="rounded-lg bg-paper px-3 py-2">
              <div className="text-xs text-gray-500">
                Pace{data.paceMonths > 1 ? `, last ${Math.round(data.paceMonths)} months` : ""}
              </div>
              <div className="font-display text-lg tabular-nums text-gray-700">
                {data.perMonth > 0.5 ? `${usd(data.perMonth)}/mo` : data.perMonth < -0.5 ? `${signed(data.perMonth)}/mo` : "—"}
              </div>
            </div>
          </div>

          {done ? (
            <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-income-600">
              At your {data.targetMonths}-month target ({usd(data.target)}). Money beyond it can work harder in investments.
            </p>
          ) : data.reachBy ? (
            <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm text-gray-700">
              At this pace you reach {data.targetMonths} months ({usd(data.target)}) around <b>{monthName(data.reachBy)}</b>
              {data.monthsToTarget != null && <> — {data.monthsToTarget} month{data.monthsToTarget === 1 ? "" : "s"} from now</>}.{" "}
              {data.monthsToTarget != null && data.monthsToTarget > 12 && (
                <>
                  To get there within a year instead, set aside about <b className="tabular-nums">{usd(data.perPaycheck12)}</b> from each paycheck.
                </>
              )}
            </p>
          ) : (
            <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm text-gray-700">
              <b className="tabular-nums">{usd(data.gap)}</b> more reaches {data.targetMonths} months ({usd(data.target)}): about{" "}
              <b className="tabular-nums">{usd(data.perPaycheck12)}</b> from each paycheck for a year, or <b className="tabular-nums">{usd(data.perPaycheck6)}</b> to get
              there in six months. Keep it in a separate high-yield savings account so it isn&apos;t spent and still earns interest.
            </p>
          )}

          {data.source === "account" ? (
            <p className="mt-3 text-sm text-gray-600">
              To add money, record a transfer into {data.fundAccounts.join(" or ")} on the{" "}
              <a href="/instruments" className="text-brand-700 underline">
                Instruments
              </a>{" "}
              page.
            </p>
          ) : entry ? (
            <form onSubmit={addEntry} className="mt-3 space-y-2 rounded-lg border p-3 text-sm">
              <div className="font-medium">{entry === "IN" ? "Add money to the fund" : "Take money out of the fund"}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="block">
                  <span className="text-xs text-gray-500">Amount (USD)</span>
                  <input
                    inputMode="decimal"
                    autoFocus
                    placeholder="1000"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="mt-0.5 w-full rounded-md border px-3 py-2 tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500">{entry === "IN" ? "Who put it in" : "Who took it"}</span>
                  <select value={form.by} onChange={(e) => setForm({ ...form, by: e.target.value })} className="mt-0.5 w-full rounded-md border px-3 py-2">
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.id === data.me ? " (you)" : ""}
                      </option>
                    ))}
                    <option value="">Joint</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500">Date</span>
                  <input
                    type="date"
                    max={data.today}
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="mt-0.5 w-full rounded-md border px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500">Note (optional)</span>
                  <input
                    maxLength={200}
                    placeholder={entry === "IN" ? "Bonus" : "Car repair"}
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    className="mt-0.5 w-full rounded-md border px-3 py-2"
                  />
                </label>
              </div>
              {error && <p className="text-xs text-expense-600">{error}</p>}
              <div className="flex gap-2">
                <button disabled={busy || !form.amount.trim()} className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white disabled:opacity-50">
                  {busy ? "Saving…" : entry === "IN" ? "Add" : "Take out"}
                </button>
                <button type="button" onClick={() => setEntry(null)} className="rounded-md border px-3 py-2 text-gray-600">
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex gap-2 text-sm">
              <button onClick={() => openEntry("IN")} className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">
                + Add money
              </button>
              <button onClick={() => openEntry("OUT")} className="rounded-md border px-3 py-1.5 text-gray-700">
                Take out
              </button>
            </div>
          )}

          {data.history.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">{data.source === "account" ? "Recent activity" : "History"}</h3>
              <ul className="mt-1 divide-y text-sm">
                {data.history.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-16 shrink-0 text-xs text-gray-500">{formatDate(h.date, { month: "short", day: "numeric" })}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-700">
                      {h.by ?? h.label}
                      {h.note && <span className="text-gray-400"> · {h.note}</span>}
                    </span>
                    <span className={`tabular-nums ${h.amountUsd >= 0 ? "text-income-600" : "text-expense-600"}`}>{signed(h.amountUsd)}</span>
                    {data.source !== "account" && (
                      <button
                        onClick={() => removeEntry(h)}
                        disabled={busy}
                        aria-label={`Remove ${signed(h.amountUsd)} on ${h.date}`}
                        className="px-1 text-gray-400 hover:text-expense-600"
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {data.entryCount > data.history.length && <p className="text-xs text-gray-400">Showing the latest {data.history.length} of {data.entryCount}.</p>}
              {data.source !== "account" && data.byPerson.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  Put in so far: {data.byPerson.map((p) => `${p.name} ${signed(p.net)}`).join(" · ")}
                  {Math.abs(data.startingUsd) >= 0.5 && ` · starting amount ${usd(data.startingUsd)}`}
                </p>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-gray-400">
            {data.source === "account" ? `From ${data.fundAccounts.join(", ")}. ` : "Starting amount plus the money added and taken out since. "}
            Essentials averaged over the last {data.monthsAveraged} full month{data.monthsAveraged === 1 ? "" : "s"} (all spending about {usd(data.totalMonthly)}/mo).
            {data.checkingUsd > 0 && ` Checking (${usd(data.checkingUsd)}) is for bills and isn't counted.`}
            {data.inrInIndia > 0 && ` ${money(data.inrInIndia, "INR", 0)} in India isn't counted.`}
          </p>
        </>
      )}
    </section>
  );
}
