"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/formatDate";
import PaycheckForm, { PaycheckDetail, periodLabel, shiftDay } from "@/components/paychecks/PaycheckForm";
import {
  BUCKET_LABELS,
  Bucket,
  Cycle,
  CycleTransaction,
  ExpectedPayday,
  daysBetween,
  summarizeCycle,
} from "@/lib/payCycles";

// One paycheck at a time: what came in, where it went, what's due before the
// next one, and what's left. Built on actual Salary deposits every 14 days
// (see src/lib/payCycles.ts); amounts are approximate USD.

type Bill = { id: string; date: string; label: string; categoryName: string; instrumentName: string; amount: number; currency: string; usd: number };
// A bill found in history rather than set up as a recurring template.
type ExpectedBill = Omit<Bill, "id"> & { key: string; frequency: string };
type Bank = { id: string; name: string; currency: string; balance: number | null; usd: number | null };
type Account = { id: string; name: string; currency: string };
type Data =
  | { hasData: false; today: string; banks: Account[]; details: Record<string, PaycheckDetail> }
  | {
      hasData: true;
      today: string;
      banks: Account[];
      details: Record<string, PaycheckDetail>;
      cycles: Cycle[];
      expected: ExpectedPayday[];
      earlierSalaryDays: number;
      transactions: CycleTransaction[];
      truncated: boolean;
      upcomingBills: Bill[];
      expectedBills: ExpectedBill[];
      setAsidePerPaycheckUsd: number;
      bankBalances: Bank[];
    };

// Bars and legend, in the order money leaves a paycheck.
const SEGMENTS: { bucket: Bucket; color: string }[] = [
  { bucket: "BILLS", color: "bg-ink-600" },
  { bucket: "DEBT", color: "bg-expense-500" },
  { bucket: "SPENDING", color: "bg-brand-400" },
  { bucket: "SAVINGS", color: "bg-income-500" },
];
const BUCKET_COLOR: Partial<Record<Bucket, string>> = Object.fromEntries(SEGMENTS.map((s) => [s.bucket, s.color]));

function usd(n: number, cents = false) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

function signedUsd(n: number) {
  return `${n < 0 ? "−" : ""}${usd(Math.abs(n))}`;
}

function money(n: number, currency: string) {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(d: string, withYear = false) {
  return formatDate(d, { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function inDays(n: number) {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 0) return `${plural(-n, "day")} ago`;
  return `in ${n} days`;
}

export default function PaychecksPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // "add" for a new paycheck, or the Salary transaction whose hours are being edited.
  const [form, setForm] = useState<"add" | string | null>(null);

  // keep: stay on the selected cycle (after editing hours); otherwise go to
  // the latest one (first load, a new paycheck).
  const load = useCallback((keep = false) => {
    fetch("/api/paychecks", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : "Couldn't load your paychecks.");
        setData(body);
        if (body.hasData) setSelected((cur) => (keep && cur != null && cur < body.cycles.length ? cur : body.cycles.length - 1));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => load(), [load]);

  function closeForm(saved: boolean) {
    const wasAdding = form === "add";
    setForm(null);
    if (saved) load(!wasAdding);
  }

  const cycle = data?.hasData && selected !== null ? data.cycles[selected] : null;
  const summary = useMemo(
    () => (data?.hasData && cycle ? summarizeCycle(cycle, data.transactions, data.today) : null),
    [data, cycle]
  );
  const history = useMemo(
    () => (data?.hasData ? data.cycles.map((c) => ({ cycle: c, s: summarizeCycle(c, data.transactions, data.today) })).reverse() : []),
    [data]
  );

  function select(i: number) {
    setSelected(i);
    setCategoryFilter(null);
  }

  if (error) return <p className="rounded-lg border bg-white p-4 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;

  // A new paycheck's likely pay period: the two weeks after the last one recorded, and the usual hours.
  const latestDetail = Object.values(data.details)
    .filter((d) => d.periodEnd)
    .sort((a, b) => b.periodEnd!.localeCompare(a.periodEnd!))[0];
  const suggested: PaycheckDetail | undefined = latestDetail
    ? { hoursPaid: latestDetail.hoursPaid, periodStart: shiftDay(latestDetail.periodEnd!, 1), periodEnd: shiftDay(latestDetail.periodEnd!, 14) }
    : undefined;
  const addButton = (
    <button onClick={() => setForm(form === "add" ? null : "add")} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
      + Add paycheck
    </button>
  );
  const addForm = form === "add" && <PaycheckForm banks={data.banks} today={data.today} suggested={suggested} onDone={closeForm} />;

  if (!data.hasData || !cycle || !summary) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Paychecks</h1>
          {addButton}
        </div>
        {addForm}
        <div className="rounded-lg border bg-white p-4 text-sm text-gray-600">
          Add each paycheck with <strong>+ Add paycheck</strong> (or as a transaction in the <strong>Salary</strong> category) on the day it
          lands. This page then splits your money into pay cycles and shows where each paycheck went.
        </div>
      </div>
    );
  }

  const { cycles, expected, today } = data;
  const isCurrent = cycle.isCurrent;
  const nextIn = daysBetween(today, cycle.nextPayday);
  const late = isCurrent && nextIn < 0;
  const billsAhead: (Bill & { fromHistory?: boolean })[] = isCurrent
    ? [...data.upcomingBills, ...data.expectedBills.map((b) => ({ ...b, id: b.key, fromHistory: true }))].sort((a, b) =>
        a.date.localeCompare(b.date)
      )
    : [];
  const billsAheadUsd = billsAhead.reduce((s, b) => s + b.usd, 0);
  const afterBills = summary.leftOver - billsAheadUsd;
  const knownBanks = data.bankBalances.filter((b) => b.balance !== null);
  const shown = categoryFilter ? summary.transactions.filter((t) => t.categoryId === categoryFilter) : summary.transactions;
  const filterLabel = categoryFilter ? summary.byCategory.find((c) => c.categoryId === categoryFilter)?.label : null;

  // Bar scale: the paycheck (plus other income), or what went out if more did.
  const scale = Math.max(summary.moneyIn, summary.outTotal, 1);
  const barParts = [
    ...SEGMENTS.map((s) => ({ key: s.bucket, label: BUCKET_LABELS[s.bucket], value: summary[bucketKey(s.bucket)], color: s.color })),
    { key: "LEFT", label: summary.leftOver >= 0 ? "Left" : "Overspent", value: Math.abs(summary.leftOver), color: summary.leftOver >= 0 ? "bg-income-500/25" : "bg-expense-600/30" },
  ].filter((p) => p.value > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Paychecks</h1>
          <p className="text-sm text-gray-500">Each paycheck, where it went, and what&rsquo;s left before the next one.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {addButton}
          <button
            onClick={() => select(cycle.index - 1)}
            disabled={cycle.index === 0}
            aria-label="Previous paycheck"
            className="rounded-md border bg-white px-2.5 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40"
          >
            ◀
          </button>
          <div className="min-w-[13rem] rounded-md border bg-white px-3 py-1.5 text-center text-sm">
            <span className="font-medium">{formatDate(cycle.start, { month: "short", day: "numeric" })}</span>
            {" – "}
            <span className="font-medium">{formatDate(cycle.end, { month: "short", day: "numeric", year: "numeric" })}</span>
            {isCurrent && <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-700">Current</span>}
          </div>
          <button
            onClick={() => select(cycle.index + 1)}
            disabled={cycle.index === cycles.length - 1}
            aria-label="Next paycheck"
            className="rounded-md border bg-white px-2.5 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40"
          >
            ▶
          </button>
        </div>
      </div>

      {addForm}

      {/* Headline tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Paycheck"
          value={usd(cycle.paycheck.usd, true)}
          sub={`received ${day(cycle.start)}${summary.otherIncome > 0 ? ` · +${usd(summary.otherIncome)} other income` : ""}`}
        />
        <Tile
          label={isCurrent ? "Spent so far" : "Spent"}
          value={usd(summary.spent, true)}
          tone="expense"
          sub={isCurrent ? `day ${summary.daysElapsed} of ${summary.days}` : `over ${summary.days} days`}
        />
        <Tile
          label={summary.leftOver >= 0 ? "Left from this paycheck" : "Over this paycheck by"}
          value={usd(Math.abs(summary.leftOver), true)}
          tone={summary.leftOver >= 0 ? "income" : "expense"}
          sub={summary.savings > 0 ? `after ${usd(summary.savings)} saved` : "after everything spent"}
        />
        <Tile
          label={late ? "Next paycheck (late)" : "Next paycheck"}
          value={day(cycle.nextPayday)}
          tone={late ? "expense" : undefined}
          sub={
            cycle.nextConfirmed
              ? "received"
              : late
                ? `expected ${plural(-nextIn, "day")} ago — not recorded yet`
                : `expected ${inDays(nextIn)}`
          }
        />
      </div>

      {form && form !== "add" ? (
        <PaycheckForm
          banks={data.banks}
          today={today}
          transactionId={form}
          amount={cycle.paycheck.usd}
          initial={data.details[form]}
          onDone={closeForm}
        />
      ) : (
        <PayDetailLine detail={data.details[cycle.paycheck.transactionId]} paycheckUsd={cycle.paycheck.usd} onEdit={() => setForm(cycle.paycheck.transactionId)} />
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Where it went */}
        <section className="space-y-4 rounded-lg border bg-white p-4 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">Where this paycheck went</h2>
            <span className="text-xs text-gray-500">
              {usd(summary.moneyIn)} in · {usd(summary.outTotal)} out
            </span>
          </div>

          <div>
            <div className="flex h-5 w-full overflow-hidden rounded bg-gray-100" role="img" aria-label="Paycheck breakdown">
              {barParts.map((p) => (
                <div
                  key={p.key}
                  className={`${p.color} h-full`}
                  style={{ width: `${(p.value / scale) * 100}%` }}
                  title={`${p.label}: ${usd(p.value)}`}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
              {barParts.map((p) => (
                <li key={p.key} className="flex items-center gap-1.5">
                  <span className={`inline-block h-2.5 w-2.5 rounded-sm ${p.color}`} />
                  {p.label} <span className="tabular-nums text-gray-900">{usd(p.value)}</span>
                </li>
              ))}
            </ul>
          </div>

          {summary.byCategory.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing spent in this cycle yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {summary.byCategory.map((c) => {
                  const active = categoryFilter === c.categoryId;
                  return (
                    <tr
                      key={c.categoryId}
                      onClick={() => setCategoryFilter(active ? null : c.categoryId)}
                      className={`cursor-pointer border-b last:border-0 hover:bg-gray-50 ${active ? "bg-brand-50" : ""}`}
                      title="Show these transactions"
                    >
                      <td className="py-1.5 pr-3">
                        {c.label}
                        <span className="ml-2 text-xs text-gray-400">{BUCKET_LABELS[c.bucket]}</span>
                      </td>
                      <td className="hidden w-1/3 py-1.5 pr-3 sm:table-cell" aria-hidden>
                        <span
                          className={`block h-1.5 rounded-r ${BUCKET_COLOR[c.bucket] ?? "bg-gray-400"}`}
                          style={{ width: `${Math.max(2, (c.total / Math.max(summary.moneyIn, 1)) * 100)}%` }}
                        />
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">{usd(c.total, true)}</td>
                      <td className="w-20 whitespace-nowrap py-1.5 text-right text-xs tabular-nums text-gray-400">
                        {summary.moneyIn > 0 ? `${Math.round((c.total / summary.moneyIn) * 100)}% of pay` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {summary.notCountedNet !== 0 && (
            <p className="text-xs text-gray-500">
              Not counted above: {signedUsd(summary.notCountedNet)} net in card payments, transfers and loans this cycle.
            </p>
          )}
        </section>

        {/* Before the next paycheck + calendar */}
        <div className="space-y-5">
          {isCurrent && (
            <section className="space-y-2 rounded-lg border border-l-4 border-l-brand-500 bg-white p-4">
              <h2 className="font-medium">Before your next paycheck</h2>
              {billsAhead.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No bills expected before {day(cycle.nextPayday)}.{" "}
                  <Link href="/recurring" className="text-brand-600 hover:underline">
                    See all recurring bills
                  </Link>
                  .
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {billsAhead.map((b) => (
                    <li key={b.id} className="flex justify-between gap-2 py-1.5">
                      <span>
                        {b.label}
                        <span className="block text-xs text-gray-400">
                          {day(b.date)} · {b.instrumentName}
                          {b.fromHistory && " · expected from your history"}
                        </span>
                      </span>
                      <span className="tabular-nums">{b.currency === "USD" ? usd(b.amount, true) : money(b.amount, b.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-between border-t pt-2 text-sm">
                <span className="text-gray-600">Left after these bills</span>
                <span className={`font-medium tabular-nums ${afterBills >= 0 ? "text-income-600" : "text-expense-600"}`}>
                  {signedUsd(afterBills)}
                </span>
              </div>
              {data.setAsidePerPaycheckUsd > 0 && (
                <p className="text-xs text-gray-500">
                  Your regular bills need about <strong>{usd(data.setAsidePerPaycheckUsd)}</strong> from each paycheck.{" "}
                  <Link href="/recurring" className="text-brand-600 hover:underline">
                    Details
                  </Link>
                </p>
              )}
              {!late && summary.daysLeft > 0 && afterBills > 0 && (
                <p className="text-xs text-gray-500">
                  About {usd(afterBills / summary.daysLeft)} a day for the {plural(summary.daysLeft, "day")} left.
                </p>
              )}
            </section>
          )}

          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-2 font-medium">Bank balance now</h2>
            {knownBanks.length === 0 ? (
              <p className="text-sm text-gray-500">
                Not available — set an opening balance on your bank accounts in{" "}
                <Link href="/instruments" className="text-brand-600 hover:underline">
                  Instruments
                </Link>{" "}
                to see real cash here.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {knownBanks.map((b) => (
                  <li key={b.id} className="flex justify-between">
                    <span>{b.name}</span>
                    <span className="tabular-nums">{money(b.balance!, b.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-2 font-medium">Paycheck calendar</h2>
            <ul className="space-y-1 text-sm">
              {expected
                .slice()
                .reverse()
                .map((e) => (
                  <li key={e.date} className="flex justify-between gap-2 text-gray-500">
                    <span>
                      {day(e.date, true)}
                      {e.holiday && (
                        <span className="block text-xs text-brand-700">
                          {e.holiday} — likely {day(e.likelyDate!)}
                        </span>
                      )}
                    </span>
                    <span className="text-xs">expected</span>
                  </li>
                ))}
              {cycles
                .slice()
                .reverse()
                .map((c) => (
                  <li key={c.start} className="flex justify-between gap-2">
                    <button onClick={() => select(c.index)} className="text-left hover:underline">
                      {day(c.start, true)}
                    </button>
                    <span className="tabular-nums text-income-600">{usd(c.paycheck.usd)} ✓</span>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      </div>

      {/* Transactions in this cycle */}
      <section className="rounded-lg border bg-white p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">
            {filterLabel ? `${filterLabel} in this cycle` : "Transactions in this cycle"}{" "}
            <span className="text-sm font-normal text-gray-400">({shown.length})</span>
          </h2>
          {filterLabel && (
            <button onClick={() => setCategoryFilter(null)} className="text-sm text-brand-600 hover:underline">
              Show all
            </button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-gray-400">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-normal">Date</th>
                  <th className="py-1.5 pr-3 font-normal">Description</th>
                  <th className="hidden py-1.5 pr-3 font-normal sm:table-cell">Category</th>
                  <th className="hidden py-1.5 pr-3 font-normal md:table-cell">Account</th>
                  <th className="py-1.5 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-gray-500">{formatDate(t.date, { month: "short", day: "numeric" })}</td>
                    <td className="py-1.5 pr-3">{t.notes || <span className="text-gray-400">—</span>}</td>
                    <td className="hidden py-1.5 pr-3 text-gray-600 sm:table-cell">{t.categoryName}</td>
                    <td className="hidden py-1.5 pr-3 text-gray-600 md:table-cell">{t.instrumentName}</td>
                    <td
                      className={`whitespace-nowrap py-1.5 text-right tabular-nums ${t.direction === "INCOME" ? "text-income-600" : ""}`}
                    >
                      {t.direction === "INCOME" ? "+" : ""}
                      {t.currency === "USD" ? usd(t.amount, true) : money(t.amount, t.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Every cycle */}
      {cycles.length > 1 && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 font-medium">All pay cycles</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-normal">Paycheck</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Amount</th>
                  <th className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">Hours</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Spent</th>
                  <th className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">Saved</th>
                  <th className="py-1.5 text-right font-normal">Left</th>
                </tr>
              </thead>
              <tbody>
                {history.map(({ cycle: c, s }) => (
                  <tr
                    key={c.start}
                    onClick={() => select(c.index)}
                    className={`cursor-pointer border-b last:border-0 hover:bg-gray-50 ${c.index === cycle.index ? "bg-brand-50" : ""}`}
                  >
                    <td className="whitespace-nowrap py-1.5 pr-3">
                      {day(c.start, true)}
                      {c.isCurrent && <span className="ml-2 text-xs text-brand-700">current</span>}
                      {data.details[c.paycheck.transactionId]?.periodStart && (
                        <span className="block text-xs text-gray-400">
                          worked {periodLabel(data.details[c.paycheck.transactionId].periodStart!, data.details[c.paycheck.transactionId].periodEnd!)}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{usd(c.paycheck.usd)}</td>
                    <td className="hidden py-1.5 pr-3 text-right tabular-nums text-gray-600 sm:table-cell">
                      {data.details[c.paycheck.transactionId]?.hoursPaid ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{usd(s.spent)}</td>
                    <td className="hidden py-1.5 pr-3 text-right tabular-nums sm:table-cell">{usd(s.savings)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${s.leftOver >= 0 ? "text-income-600" : "text-expense-600"}`}>
                      {signedUsd(s.leftOver)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="space-y-1 text-xs text-gray-500">
        {data.earlierSalaryDays > 0 && (
          <p>
            Pay cycles start on {day(cycles[0].start, true)}: earlier Salary entries aren&rsquo;t two weeks apart (for
            example, one entry a month), so they can&rsquo;t be split into paychecks. Those months are in{" "}
            <Link href="/reports" className="text-brand-600 hover:underline">
              Reports
            </Link>
            .
          </p>
        )}
        <p>
          Each category&rsquo;s type (Bill, Debt payment, Savings, Transfer…) decides where its transactions go — change
          them in{" "}
          <Link href="/categories" className="text-brand-600 hover:underline">
            Categories
          </Link>
          . Refunds reduce spending; card payments, transfers and loans are never counted. Amounts are approximate USD.
        </p>
        {data.truncated && <p className="text-expense-600">Showing the most recent 5,000 transactions only.</p>}
      </div>
    </div>
  );
}

function bucketKey(b: Bucket): "bills" | "debt" | "spending" | "savings" {
  return b === "BILLS" ? "bills" : b === "DEBT" ? "debt" : b === "SAVINGS" ? "savings" : "spending";
}

// The selected paycheck's hours and pay period, or a prompt to add them.
function PayDetailLine({ detail, paycheckUsd, onEdit }: { detail?: PaycheckDetail; paycheckUsd: number; onEdit: () => void }) {
  const has = detail && (detail.hoursPaid != null || detail.periodStart);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-white px-4 py-2.5 text-sm">
      {has ? (
        <>
          {detail.periodStart && detail.periodEnd && (
            <span>
              <span className="text-gray-500">Pay period</span> <b>{periodLabel(detail.periodStart, detail.periodEnd)}</b>
            </span>
          )}
          {detail.hoursPaid != null && (
            <span>
              <b className="tabular-nums">{detail.hoursPaid}</b> <span className="text-gray-500">hours paid</span>
            </span>
          )}
          {detail.hoursPaid != null && detail.hoursPaid > 0 && (
            <span className="tabular-nums text-gray-500">${(paycheckUsd / detail.hoursPaid).toFixed(2)} an hour take-home</span>
          )}
        </>
      ) : (
        <span className="text-gray-500">No hours or pay period for this paycheck yet.</span>
      )}
      <button onClick={onEdit} className="text-brand-600 hover:underline">
        {has ? "Edit" : "Add hours & pay period"}
      </button>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "income" | "expense" }) {
  const color = tone === "income" ? "text-income-600" : tone === "expense" ? "text-expense-600" : "text-ink-900";
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`font-display text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}
