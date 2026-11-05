// Pure helpers behind the Reports page: turn the transactions of a period
// into the four reports, and any report into CSV. No React, no Prisma, so
// they can be tested on their own. Money is aggregated in approximate USD
// (like the Dashboard); the transaction list keeps original currencies.

import { merchantKeys } from "@/lib/merchantKey";

export type ReportTransaction = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  usd: number; // approximate USD
  notes: string | null;
  categoryId: string;
  categoryName: string;
  direction: "INCOME" | "EXPENSE";
  instrumentId: string;
  instrumentName: string;
  source: string;
  createdByName: string;
};

export type CardCheck = {
  id: string;
  name: string;
  last4: string | null;
  currency: string;
  owedAtStart: number;
  purchases: number;
  refunds: number;
  payments: number;
  otherTransfersOut: number;
  owedAtEnd: number;
  purchaseCount: number;
  basedOnTransactionsOnly: boolean;
};

export type Slice = { key: string; label: string; total: number; count: number; share: number };

const round = (n: number) => Math.round(n * 100) / 100;

function slices(groups: Map<string, { label: string; total: number; count: number }>): Slice[] {
  const all = Array.from(groups.entries()).map(([key, g]) => ({ key, ...g, total: round(g.total) }));
  const sum = all.reduce((s, g) => s + g.total, 0) || 1;
  return all.map((g) => ({ ...g, share: g.total / sum })).sort((a, b) => b.total - a.total);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

// A readable merchant name for grouping: the first merchant key, title-cased,
// or the raw description when there's no recognisable merchant.
export function merchantLabel(notes: string | null): string {
  const key = merchantKeys(notes)[0];
  if (!key) return (notes ?? "").trim() || "(no description)";
  return key.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Groups by the main merchant word ("COSTCO WHSE #1" and "COSTCO" are one
// merchant), labelled with the fuller name when every row agrees on it.
function topMerchants(expenses: ReportTransaction[]): Slice[] {
  const m = new Map<string, { labels: Set<string>; total: number; count: number }>();
  for (const t of expenses) {
    const keys = merchantKeys(t.notes);
    const key = keys[keys.length - 1] ?? (t.notes ?? "").trim().toUpperCase();
    const g = m.get(key) ?? { labels: new Set<string>(), total: 0, count: 0 };
    g.labels.add(merchantLabel(t.notes));
    g.total += t.usd;
    g.count += 1;
    m.set(key, g);
  }
  const titled = (k: string) => k.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) || "(no description)";
  return slices(
    new Map(
      Array.from(m.entries()).map(([key, g]) => [
        key,
        { label: g.labels.size === 1 ? [...g.labels][0] : titled(key), total: g.total, count: g.count },
      ])
    )
  ).slice(0, 10);
}

export function spendingSummary(txns: ReportTransaction[], from: string, to: string) {
  const expenses = txns.filter((t) => t.direction === "EXPENSE");
  const income = txns.filter((t) => t.direction === "INCOME");
  const spent = round(expenses.reduce((s, t) => s + t.usd, 0));
  const received = round(income.reduce((s, t) => s + t.usd, 0));

  const group = (rows: ReportTransaction[], keyOf: (t: ReportTransaction) => [string, string]) => {
    const m = new Map<string, { label: string; total: number; count: number }>();
    for (const t of rows) {
      const [key, label] = keyOf(t);
      const g = m.get(key) ?? { label, total: 0, count: 0 };
      g.total += t.usd;
      g.count += 1;
      m.set(key, g);
    }
    return slices(m);
  };

  return {
    spent,
    received,
    net: round(received - spent),
    expenseCount: expenses.length,
    incomeCount: income.length,
    days: daysBetween(from, to),
    dailyAverage: round(spent / Math.max(1, daysBetween(from, to))),
    byCategory: group(expenses, (t) => [t.categoryId, t.categoryName]),
    byAccount: group(expenses, (t) => [t.instrumentId, t.instrumentName]),
    topMerchants: topMerchants(expenses),
    incomeByCategory: group(income, (t) => [t.categoryId, t.categoryName]),
  };
}

// "2026-11" style keys for every month the period touches, oldest first.
export function monthsInPeriod(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  for (let guard = 0; guard < 120; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function monthVsMonth(txns: ReportTransaction[], from: string, to: string) {
  const months = monthsInPeriod(from, to);
  const rows = new Map<string, { label: string; byMonth: number[] }>();
  const totals = months.map(() => 0);
  for (const t of txns) {
    if (t.direction !== "EXPENSE") continue;
    const i = months.indexOf(t.date.slice(0, 7));
    if (i < 0) continue;
    const row = rows.get(t.categoryId) ?? { label: t.categoryName, byMonth: months.map(() => 0) };
    row.byMonth[i] += t.usd;
    totals[i] += t.usd;
    rows.set(t.categoryId, row);
  }
  const categories = Array.from(rows.entries())
    .map(([key, r]) => {
      const byMonth = r.byMonth.map(round);
      const last = byMonth[byMonth.length - 1];
      const prev = byMonth.length > 1 ? byMonth[byMonth.length - 2] : null;
      return {
        key,
        label: r.label,
        byMonth,
        total: round(byMonth.reduce((s, v) => s + v, 0)),
        // Change in the last month vs the one before; null without a base.
        change: prev ? Math.round(((last - prev) / prev) * 100) : null,
      };
    })
    .sort((a, b) => b.total - a.total);
  return { months, categories, totals: totals.map(round), total: round(totals.reduce((s, v) => s + v, 0)) };
}

export function filterTransactions(
  txns: ReportTransaction[],
  opts: { type: "ALL" | "EXPENSE" | "INCOME"; search: string }
) {
  const q = opts.search.trim().toLowerCase();
  return txns.filter(
    (t) =>
      (opts.type === "ALL" || t.direction === opts.type) &&
      (!q ||
        (t.notes ?? "").toLowerCase().includes(q) ||
        t.categoryName.toLowerCase().includes(q) ||
        t.instrumentName.toLowerCase().includes(q))
  );
}

// Totals per currency, so a mixed USD/INR list doesn't add rupees to dollars.
export function totalsByCurrency(txns: ReportTransaction[]) {
  const m = new Map<string, { spent: number; received: number }>();
  for (const t of txns) {
    const c = m.get(t.currency) ?? { spent: 0, received: 0 };
    if (t.direction === "EXPENSE") c.spent += t.amount;
    else c.received += t.amount;
    m.set(t.currency, c);
  }
  return Array.from(m.entries()).map(([currency, c]) => ({ currency, spent: round(c.spent), received: round(c.received) }));
}

// RFC 4180 CSV: quote fields containing commas, quotes or newlines.
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
