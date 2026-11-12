"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/formatDate";
import { CashEvent, cashPlan, emergencyTimeline } from "@/lib/cashPlan";
import CashLine from "@/components/plan/CashLine";

// Payday planner and bill shock preview: how much is really free until the
// next paycheck, what the next 30 days of bills and paychecks do to the bank
// balance, and what a spend or a saving now would change. The plan itself is
// worked out here from /api/planner, so each "what if" is instant.

type Inputs = {
  today: string;
  cashUsd: number;
  accounts: { name: string; usd: number | null; counted: boolean; note?: string }[];
  events: CashEvent[];
  nextPayday: string | null;
  paycheckUsd: number | null;
  everydayDailyUsd: number;
  windowDays: number;
  cushionUsd: number;
};
type Emergency = { cashUsd: number; target: number; targetMonths: number; essentialsMonthly: number; monthsCovered: number | null };

const usd = (n: number, d = 0) => money(n, "USD", d);
const day = (d: string) => formatDate(d, { weekday: "short", month: "short", day: "numeric" });
const short = (d: string) => formatDate(d, { month: "short", day: "numeric" });
const num = (s: string) => {
  const n = Number(s.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export default function PlanPage() {
  const [data, setData] = useState<Inputs | null>(null);
  const [ef, setEf] = useState<Emergency | null>(null);
  const [error, setError] = useState(false);
  const [spend, setSpend] = useState("");
  const [save, setSave] = useState("");
  const [minimumOnly, setMinimumOnly] = useState(false);
  const [cushionEdit, setCushionEdit] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/planner", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
    fetch("/api/dashboard/emergency", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setEf)
      .catch(() => setEf(null));
  }, []);

  const spendUsd = num(spend);
  const saveUsd = num(save);
  const plans = useMemo(() => {
    if (!data) return null;
    const base = { today: data.today, cashUsd: data.cashUsd, events: data.events, nextPayday: data.nextPayday, everydayDailyUsd: data.everydayDailyUsd, cushionUsd: data.cushionUsd, days: data.windowDays, cardsMinimumOnly: minimumOnly };
    return { before: cashPlan(base), after: cashPlan({ ...base, spendNowUsd: spendUsd, savePerPaydayUsd: saveUsd }) };
  }, [data, minimumOnly, spendUsd, saveUsd]);

  async function saveCushion() {
    const v = cushionEdit == null ? NaN : Number(cushionEdit.replace(/[,$\s]/g, ""));
    if (!data || !Number.isFinite(v) || v < 0) return;
    setData({ ...data, cushionUsd: v });
    setCushionEdit(null);
    await fetch("/api/planner", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cushionUsd: v }) });
  }

  if (error) return <p className="text-sm text-expense-600">Couldn&apos;t load the planner. Try again in a moment.</p>;
  if (!data || !plans) return <p className="text-sm text-gray-400">Loading...</p>;

  const { before, after } = plans;
  const whatIf = spendUsd > 0 || saveUsd > 0;
  const p = whatIf ? after : before;
  const noCash = !data.accounts.some((a) => a.counted);
  // A spend the cash can't cover comes out of the emergency fund.
  const shortfall = spendUsd > 0 ? Math.min(spendUsd, Math.max(0, -after.safe)) : 0;
  const efNow = ef ? emergencyTimeline({ fundUsd: ef.cashUsd, targetUsd: ef.target, essentialsMonthly: ef.essentialsMonthly, savePerPaydayUsd: 0, today: data.today }) : null;
  const efAfter = ef ? emergencyTimeline({ fundUsd: ef.cashUsd, targetUsd: ef.target, essentialsMonthly: ef.essentialsMonthly, savePerPaydayUsd: saveUsd, shortfallUsd: shortfall, today: data.today }) : null;
  const notCounted = data.accounts.filter((a) => !a.counted);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl">Payday planner</h1>
        <p className="text-sm text-gray-500">
          {usd(data.cashUsd)} in the bank
          {data.nextPayday && data.paycheckUsd != null && (
            <>
              {" "}
              · next paycheck {day(data.nextPayday)}, about {usd(data.paycheckUsd)}
            </>
          )}
        </p>
      </div>

      {noCash && (
        <p className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm">
          Set a balance on your US bank account on <Link href="/instruments" className="underline">Accounts &amp; cards</Link> so the planner knows what you have.
        </p>
      )}

      {/* Safe to spend */}
      <section aria-label="Safe to spend" className="rounded-xl bg-ink-900 p-4 text-white shadow-sm">
        <p className="text-xs uppercase tracking-wide text-ink-300">{p.payday ? `Safe to spend until payday · ${short(p.payday)}` : "Safe to spend · next 30 days"}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <p className={`font-display text-4xl tabular-nums ${p.safe < 0 ? "text-red-300" : "text-brand-300"}`}>{usd(p.safe)}</p>
          {whatIf && Math.abs(after.safe - before.safe) >= 1 && <p className="text-sm text-ink-300 line-through tabular-nums">{usd(before.safe)}</p>}
        </div>
        <p className="mt-1 text-sm text-ink-300">
          {p.safe < 0
            ? `${usd(-p.safe)} short of what's due before payday.`
            : p.perDay != null
              ? `About ${usd(p.perDay)} a day for the ${p.daysToPayday} day${p.daysToPayday === 1 ? "" : "s"} to payday.`
              : "Bank cash less everything due in the next 30 days."}
        </p>
        <details className="mt-3 border-t border-white/15 pt-2 text-sm">
          <summary className="cursor-pointer text-ink-300">
            {usd(data.cashUsd)} in the bank − {usd(p.committed)} due before payday{p.whatIfNow > 0 ? ` − ${usd(p.whatIfNow)} what if` : ""}
          </summary>
          <ul className="mt-2 space-y-1">
            {p.dueBeforePayday.length === 0 && <li className="text-ink-300">Nothing due before payday.</li>}
            {p.dueBeforePayday.map((e) => (
              <li key={e.key} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {e.label} <span className="text-ink-300">· {short(e.date)}</span>
                </span>
                <span className="tabular-nums">−{usd(e.paid, 2)}</span>
              </li>
            ))}
          </ul>
        </details>
        <div className="mt-3 flex rounded-lg bg-white/10 p-0.5 text-xs" role="tablist" aria-label="Card bills">
          {[
            [false, "Pay cards in full"],
            [true, "Minimums only"],
          ].map(([v, l]) => (
            <button
              key={String(v)}
              role="tab"
              aria-selected={minimumOnly === v}
              onClick={() => setMinimumOnly(v as boolean)}
              className={`flex-1 rounded-md px-2 py-1.5 ${minimumOnly === v ? "bg-white text-ink-900" : "text-ink-300"}`}
            >
              {l as string}
            </button>
          ))}
        </div>
        {minimumOnly && <p className="mt-2 text-xs text-red-200">Paying only the minimum leaves the rest on the card, where it builds interest (often 20%+ a year). Use it only to get through a tight week.</p>}
      </section>

      {/* What if */}
      <section aria-label="What if" className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="font-display text-lg">What if…</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <WhatIfInput label="I spend now" value={spend} onChange={setSpend} chips={[50, 100, 250, 500]} hint="A one-time purchase today" />
          <WhatIfInput label="I save, now and each payday" value={save} onChange={setSave} chips={[100, 250, 500]} hint="Moved to the emergency fund" />
        </div>
        {whatIf && (
          <ul className="mt-4 space-y-2 text-sm">
            <Result label="Safe to spend until payday" from={before.safe} to={after.safe} />
            <Result label={`Lowest point, next ${data.windowDays} days`} from={before.lowest.balance} to={after.lowest.balance} note={short(after.lowest.date)} />
            <li className="flex justify-between gap-3">
              <span className="text-gray-600">Days under your {usd(data.cushionUsd)} cushion</span>
              <span className={`tabular-nums ${after.tight.length > before.tight.length ? "font-medium text-expense-600" : ""}`}>
                {countDays(before.tight)} → {countDays(after.tight)}
              </span>
            </li>
          </ul>
        )}
        {ef && efNow && efAfter && (
          <div className="mt-4 rounded-lg bg-paper px-3 py-2.5 text-sm">
            <p className="font-medium">Emergency fund</p>
            <p className="mt-0.5 text-gray-600">
              {usd(ef.cashUsd)} today
              {efNow.monthsCovered != null && ` (${efNow.monthsCovered} months of essentials)`} · target {usd(ef.target)} for {ef.targetMonths} months.
            </p>
            {efAfter.gap <= 0 ? (
              <p className="mt-1 text-income-600">Target reached.</p>
            ) : saveUsd > 0 ? (
              <p className="mt-1">
                Saving <b>{usd(saveUsd)}</b> now and each payday reaches it by <b>{formatDate(efAfter.reachBy!, { month: "short", year: "numeric" })}</b> — {efAfter.paychecks} paychecks, about {efAfter.months} months.
              </p>
            ) : (
              <p className="mt-1 text-gray-600">Put an amount in &ldquo;I save&rdquo; to see when you&apos;d reach it. {usd(efNow.gap)} to go.</p>
            )}
            {shortfall > 0 && (
              <p className="mt-1 text-expense-600">
                {usd(shortfall)} of that spend is more than the bank can cover before payday, so it would come out of the emergency fund
                {saveUsd > 0 ? `, ${Math.ceil(shortfall / saveUsd)} more paycheck${Math.ceil(shortfall / saveUsd) === 1 ? "" : "s"} to the target` : ""}.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Bill shock preview */}
      <section aria-label="Next 30 days" className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg">Next {data.windowDays} days</h2>
          <p className="text-xs text-gray-500">
            Flag under{" "}
            {cushionEdit == null ? (
              <button onClick={() => setCushionEdit(String(data.cushionUsd))} className="font-medium text-brand-700 underline">
                {usd(data.cushionUsd)}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1">
                $
                <input
                  autoFocus
                  inputMode="decimal"
                  value={cushionEdit}
                  onChange={(e) => setCushionEdit(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveCushion()}
                  className="w-20 rounded border px-1.5 py-0.5 text-right"
                  aria-label="Cushion"
                />
                <button onClick={saveCushion} className="rounded bg-brand-600 px-2 py-0.5 text-white">
                  Save
                </button>
              </span>
            )}
          </p>
        </div>

        {p.tight.length === 0 ? (
          <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-income-600">
            Cash stays above {usd(data.cushionUsd)} every day. Lowest: {usd(p.lowest.balance)} on {short(p.lowest.date)}.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {p.tight.map((t) => (
              <li key={t.start} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
                <p className="font-medium text-expense-600">
                  ⚠ {t.start === data.today ? "Tight now" : `Tight from ${day(t.start)}`}
                  {t.end !== t.start && ` to ${short(t.end)}`}: down to {usd(t.lowest)} on {short(t.lowestDate)}
                </p>
                <p className="mt-0.5 text-gray-700">
                  {usd(t.under)} under your cushion
                  {t.causes.length > 0 && <> after {t.causes.map((c) => `${c.label} (${usd(c.paid)}, ${short(c.date)})`).join(", ")}</>}.
                </p>
                <p className="mt-0.5 text-gray-700">
                  {t.actBy === data.today ? "Act today" : `Act by ${day(t.actBy)}`}: move {usd(Math.ceil(t.under / 10) * 10)} into checking, pay a card&apos;s minimum and the rest after payday, or hold off on a big purchase.
                </p>
              </li>
            ))}
          </ul>
        )}

        <CashLine timeline={p.timeline} cushion={data.cushionUsd} today={data.today} />

        <ol className="mt-3 divide-y text-sm">
          {p.timeline
            .filter((d) => d.events.length > 0)
            .map((d) => {
              const under = d.balance < data.cushionUsd;
              return (
                <li key={d.date} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{d.date === data.today ? "Today" : day(d.date)}</span>
                    <span className={`text-xs tabular-nums ${under ? "font-medium text-expense-600" : "text-gray-500"}`}>
                      {usd(d.balance)} after{under && " ⚠"}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {d.events.map((e) => (
                      <li key={e.key} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          <span className={e.key.startsWith("whatif:") ? "italic text-brand-700" : ""}>{e.label}</span>
                          {e.sub && <span className="text-xs text-gray-400"> · {e.sub}</span>}
                        </span>
                        <span className={`shrink-0 tabular-nums ${e.kind === "PAYCHECK" ? "text-income-600" : ""}`}>
                          {e.kind === "PAYCHECK" ? "+" : "−"}
                          {usd(e.paid, 2)}
                          {e.kind === "CARD" && minimumOnly && e.minimumUsd != null && e.paid < e.usd && <span className="text-xs text-gray-400"> min</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
        </ol>
        <p className="mt-3 text-xs text-gray-500">
          Paychecks every 14 days at your usual amount; bills from your recurring list and from history; card bills from each statement, the next one estimated from charges so far
          {data.everydayDailyUsd > 0 ? `; plus about ${usd(data.everydayDailyUsd)} a day of debit spending` : ""}.
          {notCounted.length > 0 && ` Not counted: ${notCounted.map((a) => `${a.name} (${a.note})`).join(", ")}.`}
        </p>
      </section>
    </div>
  );
}

function countDays(spells: { start: string; end: string }[]) {
  return spells.reduce((n, s) => n + Math.round((Date.parse(s.end) - Date.parse(s.start)) / 86_400_000) + 1, 0);
}

function WhatIfInput({ label, value, onChange, chips, hint }: { label: string; value: string; onChange: (v: string) => void; chips: number[]; hint: string }) {
  return (
    <div>
      <label className="text-sm font-medium">
        {label}
        <span className="mt-1 flex items-center gap-1 rounded-md border px-2 focus-within:ring-2 focus-within:ring-brand-300">
          <span className="text-gray-400">$</span>
          <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" className="w-full py-2 text-base outline-none tabular-nums" />
          {value && (
            <button type="button" onClick={() => onChange("")} className="px-1 text-gray-400" aria-label={`Clear ${label}`}>
              ✕
            </button>
          )}
        </span>
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button key={c} type="button" onClick={() => onChange(String(c))} className={`rounded-full border px-3 py-1 text-xs ${num(value) === c ? "border-brand-600 bg-brand-50 text-brand-700" : "text-gray-600"}`}>
            ${c}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-400">{hint}</p>
    </div>
  );
}

function Result({ label, from, to, note }: { label: string; from: number; to: number; note?: string }) {
  const diff = to - from;
  return (
    <li className="flex justify-between gap-3">
      <span className="text-gray-600">
        {label}
        {note && <span className="text-xs text-gray-400"> · {note}</span>}
      </span>
      <span className="tabular-nums">
        {usd(from)} → <b className={to < 0 ? "text-expense-600" : ""}>{usd(to)}</b>
        {Math.abs(diff) >= 1 && <span className="text-xs text-gray-400"> ({diff > 0 ? "+" : "−"}{usd(Math.abs(diff))})</span>}
      </span>
    </li>
  );
}
