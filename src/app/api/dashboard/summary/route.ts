import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";

// Powers the redesigned dashboard: a month/year-selectable monthly summary,
// a year-to-date summary for the same year, and an expense-by-category
// breakdown for whichever period the person clicks into (monthly or YTD).
// Both periods are computed together in one call since they're always shown
// side by side.

function summarize(transactions: { amount: any; currency: string; category: { id: string; direction: string; name: string } }[]) {
  let income = 0;
  let expense = 0;
  const expenseTotals = new Map<string, { name: string; total: number }>();
  const incomeTotals = new Map<string, { name: string; total: number }>();

  for (const t of transactions) {
    const usd = toApproxUsd(Number(t.amount), t.currency);
    const bucket = t.category.direction === "INCOME" ? incomeTotals : expenseTotals;
    if (t.category.direction === "INCOME") income += usd;
    else expense += usd;

    const existing = bucket.get(t.category.id);
    bucket.set(t.category.id, { name: t.category.name, total: (existing?.total ?? 0) + usd });
  }

  const toSortedArray = (m: Map<string, { name: string; total: number }>) =>
    Array.from(m.entries())
      .map(([id, v]) => ({ id, name: v.name, total: Math.round(v.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

  return {
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    net: Math.round((income - expense) * 100) / 100,
    expenseBreakdown: toSortedArray(expenseTotals),
    incomeBreakdown: toSortedArray(incomeTotals),
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
      include: { category: true },
    }),
    prisma.transaction.findMany({
      where: { householdId: user.householdId, date: { gte: yearStart, lt: yearEnd } },
      include: { category: true },
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
