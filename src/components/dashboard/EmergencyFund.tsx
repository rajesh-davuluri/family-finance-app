"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/money";
import { TRANSACTIONS_CHANGED } from "@/lib/events";

// The emergency fund: money set aside (typed in, or a bank account named
// "Emergency...") against months of essential spending, with the target in
// months saved for the household (6 by default) and the plan to reach it.

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
};

const usd = (n: number) => money(n, "USD", 0);
const TARGETS = [3, 6, 12] as const;

export default function EmergencyFund() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

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
            How much do you have set aside for emergencies?
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
          <p className="text-xs text-gray-500">Update it whenever you add to the fund. A bank account here named &ldquo;Emergency…&rdquo; is used instead, automatically.</p>
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
                Edit
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
          {done ? (
            <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-income-600">
              At your {data.targetMonths}-month target ({usd(data.target)}). Money beyond it can work harder in investments.
            </p>
          ) : (
            <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm text-gray-700">
              <b className="tabular-nums">{usd(data.gap)}</b> more reaches {data.targetMonths} months ({usd(data.target)}): about{" "}
              <b className="tabular-nums">{usd(data.perPaycheck12)}</b> from each paycheck for a year, or <b className="tabular-nums">{usd(data.perPaycheck6)}</b> to get
              there in six months. Keep it in a separate high-yield savings account so it isn&apos;t spent and still earns interest.
            </p>
          )}
          <p className="mt-2 text-xs text-gray-400">
            {data.source === "account" ? `From ${data.fundAccounts.join(", ")}. ` : "Amount you entered. "}
            Essentials averaged over the last {data.monthsAveraged} full month{data.monthsAveraged === 1 ? "" : "s"} (all spending about {usd(data.totalMonthly)}/mo).
            {data.checkingUsd > 0 && ` Checking (${usd(data.checkingUsd)}) is for bills and isn't counted.`}
            {data.inrInIndia > 0 && ` ${money(data.inrInIndia, "INR", 0)} in India isn't counted.`}
          </p>
        </>
      )}
    </section>
  );
}
