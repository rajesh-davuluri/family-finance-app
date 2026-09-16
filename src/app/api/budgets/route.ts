import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";

const upsertSchema = z.object({
  categoryId: z.string(),
  monthlyLimit: z.number().positive(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [budgets, monthTxns] = await Promise.all([
    prisma.budget.findMany({
      where: { householdId: user.householdId },
      include: { category: true },
      orderBy: { category: { name: "asc" } },
    }),
    prisma.transaction.findMany({
      where: { householdId: user.householdId, date: { gte: monthStart, lt: monthEnd } },
      include: { category: true },
    }),
  ]);

  // Spend-so-far is tracked in approx. USD, same convention as the
  // dashboard's cross-currency totals -- monthlyLimit is set in the same
  // terms.
  const spentByCategory = new Map<string, number>();
  for (const t of monthTxns) {
    if (t.category.direction !== "EXPENSE") continue;
    const usd = toApproxUsd(Number(t.amount), t.currency);
    spentByCategory.set(t.categoryId, (spentByCategory.get(t.categoryId) ?? 0) + usd);
  }

  const withSpend = budgets.map((b) => ({
    ...b,
    spent: Math.round((spentByCategory.get(b.categoryId) ?? 0) * 100) / 100,
  }));

  return NextResponse.json(withSpend);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = upsertSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { categoryId, monthlyLimit } = parsed.data;

  const category = await prisma.transactionCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.householdId !== user.householdId) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }
  if (category.direction !== "EXPENSE") {
    return NextResponse.json({ error: "Budgets only apply to expense categories." }, { status: 400 });
  }

  // Upsert: creating a budget for a category that already has one updates
  // the existing limit instead of erroring, since there's only ever one
  // standing budget per category.
  const existing = await prisma.budget.findUnique({
    where: { householdId_categoryId: { householdId: user.householdId, categoryId } },
  });

  const budget = existing
    ? await prisma.budget.update({ where: { id: existing.id }, data: { monthlyLimit } })
    : await prisma.budget.create({ data: { householdId: user.householdId, categoryId, monthlyLimit } });

  return NextResponse.json(budget, { status: existing ? 200 : 201 });
}
