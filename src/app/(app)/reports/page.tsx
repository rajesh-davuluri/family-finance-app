"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import { SOURCE_LABELS, TransactionSource } from "@/lib/lastActivity";
import {
  CardCheck,
  ReportTransaction,
  filterTransactions,
  monthVsMonth,
  spendingSummary,
  toCsv,
  totalsByCurrency,
} from "@/lib/reports";

// Reports for reviewing the household's money: a spending summary, the
// transaction list, month vs month by category, and a per-card statement
// check. Each can be read here, downloaded as CSV, or printed / saved as PDF
// (the print layout hides the app chrome and the controls).

type Instrument = { id: string; name: string; type: string; archived: boolean };
type Category = { id: string; name: string };
type Tab = "summary" | "transactions" | "months" | "cards";
type Preset = "this-month" | "last-month" | "last-3-months" | "year-to-date" | "last-year" | "custom";

const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Spending summary" },
  { id: "transactions", label: "Transactions" },
  { id: "months", label: "Month vs month" },
  { id: "cards", label: "Card statement check" },
];

const PRESETS: { id: Preset; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-3-months", label: "Last 3 months" },
  { id: "year-to-date", label: "Year to date" },
  { id: "last-year", label: "Last year" },
  { id: "custom", label: "Custom dates" },
];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function presetRange(p: Preset): { from: string; to: string } | null {
  const today = new Date(`${getTodayLocal()}T00:00:00`);
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (p) {
    case "this-month":
      return { from: ymd(new Date(y, m, 1)), to: ymd(today) };
    case "last-month":
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "last-3-months":
      return { from: ymd(new Date(y, m - 2, 1)), to: ymd(today) };
    case "year-to-date":
      return { from: ymd(new Date(y, 0, 1)), to: ymd(today) };
    case "last-year":
      return { from: ymd(new Date(y - 1, 0, 1)), to: ymd(new Date(y - 1, 11, 31)) };
    default:
      return null;
  }
}

function usd(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function money(n: number, currency: string) {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function download(filename: string, csv: string) {
  // BOM so Excel opens UTF-8 (₹, accents) correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [preset, setPreset] = useState<Preset>("this-month");
  const [range, setRange] = useState(() => presetRange("this-month")!);
  const [instrumentId, setInstrumentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [data, setData] = useState<{ transactions: ReportTransaction[]; cards: CardCheck[]; truncated: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [txType, setTxType] = useState<"ALL" | "EXPENSE" | "INCOME">("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/instruments").then((r) => r.json()), fetch("/api/categories").then((r) => r.json())])
      .then(([insts, cats]) => {
        setInstruments(insts);
        setCategories(cats);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!range.from || !range.to || range.from > range.to) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (instrumentId) params.set("instrumentId", instrumentId);
    if (categoryId) params.set("categoryId", categoryId);
    fetch(`/api/reports?${params}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : "Couldn't load the report.");
        setData(body);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range, instrumentId, categoryId]);

  function choosePreset(p: Preset) {
    setPreset(p);
    const r = presetRange(p);
    if (r) setRange(r);
  }

  const txns = useMemo(() => data?.transactions ?? [], [data]);
  const summary = useMemo(() => spendingSummary(txns, range.from, range.to), [txns, range]);
  const months = useMemo(() => monthVsMonth(txns, range.from, range.to), [txns, range]);
  const listed = useMemo(() => filterTransactions(txns, { type: txType, search }), [txns, txType, search]);
  const listedTotals = useMemo(() => totalsByCurrency(listed), [listed]);

  const filterLabel = [
    instrumentId ? instruments.find((i) => i.id === instrumentId)?.name : "All accounts",
    categoryId ? categories.find((c) => c.id === categoryId)?.name : "All categories",
  ].join(" · ");
  const periodLabel = `${formatDate(range.from)} – ${formatDate(range.to)}`;

  function exportCsv() {
    const base = `family-finance-${tab}-${range.from}-to-${range.to}`;
    if (tab === "summary") {
      const rows: (string | number)[][] = [
        ["Totals", "Spent", summary.spent, summary.expenseCount, ""],
        ["Totals", "Received", summary.received, summary.incomeCount, ""],
        ["Totals", "Net", summary.net, "", ""],
        ["Totals", "Daily average spent", summary.dailyAverage, "", ""],
        ...summary.byCategory.map((c) => ["Spending by category", c.label, c.total, c.count, Math.round(c.share * 100)]),
        ...summary.byAccount.map((c) => ["Spending by account", c.label, c.total, c.count, Math.round(c.share * 100)]),
        ...summary.topMerchants.map((c) => ["Top merchants", c.label, c.total, c.count, Math.round(c.share * 100)]),
        ...summary.incomeByCategory.map((c) => ["Income by category", c.label, c.total, c.count, Math.round(c.share * 100)]),
      ];
      download(`${base}.csv`, toCsv(["Section", "Name", "Amount (approx USD)", "Transactions", "Share %"], rows));
    } else if (tab === "transactions") {
      download(
        `${base}.csv`,
        toCsv(
          ["Date", "Description", "Category", "Type", "Account", "Amount", "Currency", "Approx USD", "Added", "Added by"],
          listed.map((t) => [
            t.date,
            t.notes,
            t.categoryName,
            t.direction === "INCOME" ? "Income" : "Expense",
            t.instrumentName,
            t.amount.toFixed(2),
            t.currency,
            t.usd.toFixed(2),
            SOURCE_LABELS[t.source as TransactionSource] ?? t.source,
            t.createdByName,
          ])
        )
      );
    } else if (tab === "months") {
      download(
        `${base}.csv`,
        toCsv(
          ["Category", ...months.months.map(monthName), "Total", "Change last month %"],
          [
            ...months.categories.map((c) => [c.label, ...c.byMonth, c.total, c.change ?? ""]),
            ["All categories", ...months.totals, months.total, ""],
          ]
        )
      );
    } else {
      download(
        `${base}.csv`,
        toCsv(
          ["Card", "Last 4", "Currency", "Owed at start", "Purchases", "Refunds", "Payments", "Other transfers out", "Owed at end"],
          (data?.cards ?? []).map((c) => [
            c.name,
            c.last4,
            c.currency,
            c.owedAtStart,
            c.purchases,
            c.refunds,
            c.payments,
            c.otherTransfersOut,
            c.owedAtEnd,
          ])
        )
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-sm text-gray-500 print:hidden">Review your money for any period — on screen, as CSV, or printed.</p>
          <p className="hidden text-sm text-gray-600 print:block">
            {TABS.find((t) => t.id === tab)?.label} · {periodLabel} · {filterLabel}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            onClick={exportCsv}
            disabled={!data || loading}
            className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Download CSV
          </button>
          <button
            onClick={() => window.print()}
            disabled={!data || loading}
            className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 print:hidden">
        <label className="text-xs text-gray-500">
          Period
          <select
            value={preset}
            onChange={(e) => choosePreset(e.target.value as Preset)}
            className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-gray-800"
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          From
          <input
            type="date"
            value={range.from}
            onChange={(e) => {
              setPreset("custom");
              setRange((r) => ({ ...r, from: e.target.value }));
            }}
            className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-gray-800"
          />
        </label>
        <label className="text-xs text-gray-500">
          To
          <input
            type="date"
            value={range.to}
            onChange={(e) => {
              setPreset("custom");
              setRange((r) => ({ ...r, to: e.target.value }));
            }}
            className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-gray-800"
          />
        </label>
        <label className="text-xs text-gray-500">
          Account
          <select
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
            className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-gray-800"
          >
            <option value="">All accounts</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Category
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-gray-800"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {range.from > range.to && <p className="text-xs text-red-600">“From” must be on or before “To”.</p>}
      </div>

      <div className="flex flex-wrap gap-1 border-b print:hidden" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.id ? "border-brand-500 font-medium text-ink-900" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
      ) : loading || !data ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <>
          {data.truncated && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              This period has more than 5,000 transactions — only the most recent 5,000 are included. Pick a shorter
              period for complete figures.
            </p>
          )}
          {tab === "summary" && <SummaryView summary={summary} />}
          {tab === "transactions" && (
            <TransactionsView
              listed={listed}
              totals={listedTotals}
              txType={txType}
              setTxType={setTxType}
              search={search}
              setSearch={setSearch}
            />
          )}
          {tab === "months" && <MonthsView months={months} partialLast={!isMonthEnd(range.to)} />}
          {tab === "cards" && <CardsView cards={data.cards} periodLabel={periodLabel} />}
        </>
      )}
    </div>
  );
}

function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-lg border bg-white p-4 print:break-inside-avoid print:border-gray-300">
      <h2 className="mb-3 text-sm font-medium text-gray-700">
        {title}
        {note && <span className="ml-2 text-xs font-normal text-gray-400">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

function ShareTable({
  rows,
  empty,
  tone = "expense",
}: {
  rows: ReturnType<typeof spendingSummary>["byCategory"];
  empty: string;
  tone?: "expense" | "income";
}) {
  if (rows.length === 0) return <p className="text-sm text-gray-400">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b last:border-0" title={`${r.label}: ${usd(r.total)} · ${r.count} transactions`}>
            <td className="py-1.5 pr-3">{r.label}</td>
            <td className="hidden w-1/3 py-1.5 pr-3 sm:table-cell" aria-hidden>
              <span
                className={`block h-1.5 rounded-r ${tone === "income" ? "bg-income-500" : "bg-expense-500"}`}
                style={{ width: `${Math.max(2, r.share * 100)}%` }}
              />
            </td>
            <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">{usd(r.total)}</td>
            <td className="w-12 whitespace-nowrap py-1.5 text-right text-xs tabular-nums text-gray-400">
              {Math.round(r.share * 100)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SummaryView({ summary }: { summary: ReturnType<typeof spendingSummary> }) {
  const tiles = [
    { label: "Spent", value: usd(summary.spent), sub: plural(summary.expenseCount, "transaction") },
    { label: "Received", value: usd(summary.received), sub: plural(summary.incomeCount, "transaction") },
    { label: "Net", value: `${summary.net < 0 ? "−" : ""}${usd(Math.abs(summary.net))}`, sub: "received − spent" },
    { label: "Daily average spent", value: usd(summary.dailyAverage), sub: `over ${summary.days} days` },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border bg-white p-4 print:border-gray-300">
            <div className="text-xs text-gray-500">{t.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{t.value}</div>
            <div className="text-xs text-gray-400">{t.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Spending by category">
          <ShareTable rows={summary.byCategory} empty="No spending in this period." />
        </Panel>
        <Panel title="Spending by card / account">
          <ShareTable rows={summary.byAccount} empty="No spending in this period." />
        </Panel>
        <Panel title="Top merchants" note="top 10">
          <ShareTable rows={summary.topMerchants} empty="No spending in this period." />
        </Panel>
        <Panel title="Income by category">
          <ShareTable rows={summary.incomeByCategory} empty="No income in this period." tone="income" />
        </Panel>
      </div>
      <p className="text-xs text-gray-400">Amounts in approximate USD, converted the same way as the Dashboard.</p>
    </div>
  );
}

function TransactionsView({
  listed,
  totals,
  txType,
  setTxType,
  search,
  setSearch,
}: {
  listed: ReportTransaction[];
  totals: ReturnType<typeof totalsByCurrency>;
  txType: "ALL" | "EXPENSE" | "INCOME";
  setTxType: (t: "ALL" | "EXPENSE" | "INCOME") => void;
  search: string;
  setSearch: (s: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {(["ALL", "EXPENSE", "INCOME"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTxType(t)}
            className={`rounded-md border px-3 py-1 text-sm ${txType === t ? "border-brand-500 bg-brand-50" : "bg-white"}`}
          >
            {t === "ALL" ? "All" : t === "EXPENSE" ? "Spending" : "Income"}
          </button>
        ))}
        <input
          type="search"
          placeholder="Search description, category or account"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[16rem] flex-1 rounded-md border px-3 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
        <span>{plural(listed.length, "transaction")}</span>
        {totals.map((t) => (
          <span key={t.currency}>
            {t.currency}: spent <span className="font-medium">{money(t.spent, t.currency)}</span>
            {t.received > 0 && (
              <>
                , received <span className="font-medium">{money(t.received, t.currency)}</span>
              </>
            )}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white print:overflow-visible print:border-gray-300">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="p-2">Date</th>
              <th className="p-2">Description</th>
              <th className="p-2">Category</th>
              <th className="p-2">Account</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2">Added</th>
            </tr>
          </thead>
          <tbody>
            {listed.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-400">
                  No transactions match.
                </td>
              </tr>
            )}
            {listed.map((t) => (
              <tr key={t.id} className="border-b last:border-0 print:break-inside-avoid">
                <td className="whitespace-nowrap p-2">{formatDate(t.date)}</td>
                <td className="max-w-xs p-2 text-gray-600">{t.notes || "—"}</td>
                <td className="p-2">{t.categoryName}</td>
                <td className="p-2 text-gray-600">{t.instrumentName}</td>
                <td
                  className={`whitespace-nowrap p-2 text-right tabular-nums ${
                    t.direction === "INCOME" ? "text-income-600" : "text-expense-600"
                  }`}
                >
                  {money(t.amount, t.currency)}
                </td>
                <td className="whitespace-nowrap p-2 text-xs text-gray-500">
                  {SOURCE_LABELS[t.source as TransactionSource] ?? t.source} · {t.createdByName}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Whether a YYYY-MM-DD date is the last day of its month.
function isMonthEnd(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return d === new Date(y, m, 0).getDate();
}

function MonthsView({ months, partialLast }: { months: ReturnType<typeof monthVsMonth>; partialLast: boolean }) {
  if (months.categories.length === 0) {
    return <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-400">No spending in this period.</p>;
  }
  return (
    <Panel title="Spending by category, month by month" note="approximate USD">
      {partialLast && months.months.length > 1 && (
        <p className="mb-2 text-xs text-gray-400">
          The last month is only partly over, so “Last vs prev.” compares a part month with a full one.
        </p>
      )}
      {months.months.length === 1 && (
        <p className="mb-2 text-xs text-gray-400">Pick a longer period (e.g. Last 3 months) to compare months.</p>
      )}
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-gray-500">
              <th className="py-2 pr-3 text-left">Category</th>
              {months.months.map((m, i) => (
                <th key={m} className="whitespace-nowrap py-2 pr-3 text-right">
                  {monthName(m)}
                  {partialLast && i === months.months.length - 1 && (
                    <span className="block text-[10px] font-normal text-gray-400">so far</span>
                  )}
                </th>
              ))}
              <th className="py-2 pr-3 text-right">Total</th>
              <th className="whitespace-nowrap py-2 text-right">Last vs prev.</th>
            </tr>
          </thead>
          <tbody>
            {months.categories.map((c) => (
              <tr key={c.key} className="border-b last:border-0">
                <td className="py-1.5 pr-3">{c.label}</td>
                {c.byMonth.map((v, i) => (
                  <td key={i} className={`whitespace-nowrap py-1.5 pr-3 text-right tabular-nums ${v ? "" : "text-gray-300"}`}>
                    {v ? usd(v) : "—"}
                  </td>
                ))}
                <td className="whitespace-nowrap py-1.5 pr-3 text-right font-medium tabular-nums">{usd(c.total)}</td>
                <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-gray-500">
                  {c.change === null ? "—" : `${c.change > 0 ? "↑" : c.change < 0 ? "↓" : ""} ${Math.abs(c.change)}%`}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="pt-2 pr-3">All categories</td>
              {months.totals.map((v, i) => (
                <td key={i} className="whitespace-nowrap pt-2 pr-3 text-right tabular-nums">
                  {usd(v)}
                </td>
              ))}
              <td className="whitespace-nowrap pt-2 pr-3 text-right tabular-nums">{usd(months.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

function CardsView({ cards, periodLabel }: { cards: CardCheck[]; periodLabel: string }) {
  if (cards.length === 0) {
    return (
      <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-400">
        No credit cards to check — add one on the Instruments page.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Compare with your card statement for {periodLabel}: set the period to the statement&apos;s dates, then check
        “Owed at end” against the statement&apos;s new balance.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {cards.map((c) => (
          <section key={c.id} className="rounded-lg border bg-white p-4 print:break-inside-avoid print:border-gray-300">
            <h2 className="mb-2 text-sm font-medium text-gray-700">
              {c.name}
              {c.last4 && <span className="text-gray-400"> ••{c.last4}</span>}
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["Owed at start", c.owedAtStart, ""],
                  ["+ Purchases", c.purchases, plural(c.purchaseCount, "transaction")],
                  ["− Refunds / credits", c.refunds, ""],
                  ["− Payments to the card", c.payments, "transfers in"],
                  ...(c.otherTransfersOut ? [["+ Other transfers out", c.otherTransfersOut, ""]] : []),
                ].map(([label, value, note]) => (
                  <tr key={label as string} className="border-b">
                    <td className="py-1.5 pr-3">
                      {label}
                      {note && <span className="ml-1 text-xs text-gray-400">{note}</span>}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{money(value as number, c.currency)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="pt-2 pr-3">Owed at end</td>
                  <td className="whitespace-nowrap pt-2 text-right tabular-nums">{money(c.owedAtEnd, c.currency)}</td>
                </tr>
              </tbody>
            </table>
            {c.basedOnTransactionsOnly && (
              <p className="mt-2 text-xs text-gray-400">
                No starting balance set for this card, so “owed” only counts transactions recorded in the app.
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
