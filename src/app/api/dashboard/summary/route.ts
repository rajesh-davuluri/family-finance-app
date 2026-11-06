import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";
import { countsAsSpending, flowOf, kindOf } from "@/lib/categoryKind";

// Powers the dashboard: a month/year-selectable monthly summary, a
// year-to-date summary for the same year, an expense/income-by-category
// breakdown for whichever period the person clicks into, and a spend-by-card
// (instrument) breakdown shown directly on the monthly grid. All computed
// together in one call since they're always shown side by side.

type Txn = {
  amount: Prisma.Decimal;
  currency: string;
  category: { id: string; direction: string; name: string; kind: string | null };
  instrument: { id: string; name: string };
};

// Income, spending and savings follow each category's kind
// (src/lib/categoryKind.ts): refunds reduce spending, savings aren't
// spending, and transfers (card payments) and loans count in neither.
function summarize(transactions: Txn[]) {
  let income = 0;
  let expense = 0;
  let savings = 0;
  const expenseTotals = new Map<string, { name: string; total: number }>();
  const incomeTotals = new Map<string, { name: string; total: number }>();
  const instrumentTotals = new Map<string, { name: string; total: number }>();

  const add = (m: Map<string, { name: string; total: number }>, id: string, name: string, v: number) =>
    m.set(id, { name, total: (m.get(id)?.total ?? 0) + v });

  for (const t of transactions) {
    const usd = toApproxUsd(Number(t.amount), t.currency);
    const kind = kindOf(t.category);
    const flow = flowOf(kind, usd);
    income += flow.income;
    expense += flow.spending;
    savings += flow.savings;
    if (kind === "INCOME") add(incomeTotals, t.category.id, t.category.name, usd);
    if (countsAsSpending(kind)) {
      add(expenseTotals, t.category.id, t.category.name, flow.spending);
      // Card usage is spending only -- income isn't "used on a card".
      add(instrumentTotals, t.instrument.id, t.instrument.name, flow.spending);
    }
  }

  const toSortedArray = (m: Map<string, { name: string; total: number }>) =>
    Array.from(m.entries())
      .map(([id, v]) => ({ id, name: v.name, total: Math.round(v.total * 100) / 100 }))
      .filter((v) => v.total !== 0)
      .sort((a, b) => b.total - a.total);

  return {
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    net: Math.round((income - expense) * 100) / 100,
    savings: Math.round(savings * 100) / 100,
    expenseBreakdown: toSortedArray(expenseTotals),
    incomeBreakdown: toSortedArray(incomeTotals),
    instrumentBreakdown: toSortedArray(instrumentTotals),
  };
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const month = Number(searchParams.get("month")) || now.getMonth() + 1; // 1-12
  const year = Number(searchParams.get("year")) || now.getFullYear();

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1); // exclusive

  const yearStart = new Date(year, 0, 1);
  const yearEnd = year === now.getFullYear() ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) : new Date(year + 1, 0, 1);

  const [monthlyTxns, ytdTxns] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId: user.householdId, date: { gte: monthStart, lt: monthEnd } },
      include: { category: true, instrument: true },
    }),
    prisma.transaction.findMany({
      where: { householdId: user.householdId, date: { gte: yearStart, lt: yearEnd } },
      include: { category: true, instrument: true },
    }),
  ]);

  return NextResponse.json({
    month,
    year,
    monthly: summarize(monthlyTxns),
    ytd: summarize(ytdTxns),
    monthRange: { from: monthStart.toISOString().slice(0, 10), to: new Date(monthEnd.getTime() - 1).toISOString().slice(0, 10) },
    ytdRange: { from: yearStart.toISOString().slice(0, 10), to: new Date(yearEnd.getTime() - 1).toISOString().slice(0, 10) },
  });
}
