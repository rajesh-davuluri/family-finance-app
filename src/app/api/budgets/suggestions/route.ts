import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { toApproxUsd } from "@/lib/fx";
import { kindOf, countsAsSpending, flowOf } from "@/lib/categoryKind";
import { suggestBudgets } from "@/lib/budgets";

// Budgets suggested from the last six full months: each everyday spending
// category's typical month (see src/lib/budgets.ts), with any budget it
// already has.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const from = new Date(Date.UTC(y, m - 7, 1));
  const to = new Date(Date.UTC(y, m - 1, 1)); // this month is partial: left out

  const [txns, budgets] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId: user.householdId, date: { gte: from, lt: to } },
      select: { amount: true, currency: true, date: true, category: { select: { id: true, name: true, direction: true, kind: true } } },
    }),
    prisma.budget.findMany({ where: { householdId: user.householdId }, select: { categoryId: true, monthlyLimit: true } }),
  ]);

  const monthKeys: string[] = [];
  for (let i = 6; i >= 1; i--) monthKeys.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  // Months before the household's records began aren't counted as $0 months.
  const active = new Set(txns.map((t) => t.date.toISOString().slice(0, 7)));
  const months = monthKeys.filter((k) => active.has(k));

  const byCat = new Map<string, { name: string; kind: string; spend: Map<string, number> }>();
  for (const t of txns) {
    const kind = kindOf(t.category);
    if (!countsAsSpending(kind)) continue;
    const c = byCat.get(t.category.id) ?? { name: t.category.name, kind, spend: new Map<string, number>() };
    const key = t.date.toISOString().slice(0, 7);
    c.spend.set(key, (c.spend.get(key) ?? 0) + flowOf(kind, toApproxUsd(Number(t.amount), t.currency)).spending);
    byCat.set(t.category.id, c);
  }

  const existing = new Map(budgets.map((b) => [b.categoryId, Number(b.monthlyLimit)]));
  const suggestions = suggestBudgets(
    [...byCat.entries()].map(([categoryId, c]) => ({ categoryId, name: c.name, kind: c.kind, monthly: months.map((k) => c.spend.get(k) ?? 0) })),
  ).map((s) => ({ ...s, currentLimit: existing.get(s.categoryId) ?? null }));

  return NextResponse.json({ monthsUsed: months.length, suggestions });
}
