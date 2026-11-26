import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";
import { countsAsSpending, flowOf, kindOf } from "@/lib/categoryKind";
import { addDays, daysUntil, PAY_INTERVAL_DAYS } from "@/lib/payCycle";

// Powers the "Current Pay Cycle" dashboard widget.
//
// Rajesh is paid every 14 days, not on a fixed calendar date, so this never
// assumes a payday-of-month. Instead: find the most recent transaction in
// the "Salary" category, treat that date as the start of the current pay
// cycle, and project the next paycheck 14 days out. Everything else (what's
// been spent since, what bills are still due before the next paycheck, and
// what's actually left) is computed from real transactions and active
// Recurring templates -- nothing here is stored, so it's always current.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const lastPaycheck = await prisma.transaction.findFirst({
    where: {
      householdId: user.householdId,
      category: { name: "Salary", direction: "INCOME" },
    },
    orderBy: { date: "desc" },
    include: { instrument: true },
  });

  if (!lastPaycheck) {
    return NextResponse.json({ hasData: false });
  }

  const now = new Date();
  const cycleStart = new Date(lastPaycheck.date);
  const nextPaycheck = addDays(cycleStart, PAY_INTERVAL_DAYS);

  // Everything else logged since the paycheck landed: expenses reduce what's
  // available, any other income (bonus, refund, etc.) adds to it. Transfers
  // are a separate model entirely and never enter this -- paying a credit
  // card bill from checking doesn't count as spending twice.
  const periodTxns = await prisma.transaction.findMany({
    where: {
      householdId: user.householdId,
      date: { gte: cycleStart, lte: now },
      NOT: { id: lastPaycheck.id },
    },
    include: { category: true },
  });

  // Each category's kind decides how it counts: refunds reduce spending,
  // savings stay out of it, and card payments / transfers / loans count in
  // neither (src/lib/categoryKind.ts).
  let spentSoFarUsd = 0;
  let otherIncomeUsd = 0;
  let savedUsd = 0;
  for (const t of periodTxns) {
    const flow = flowOf(kindOf(t.category), toApproxUsd(Number(t.amount), t.currency));
    spentSoFarUsd += flow.spending;
    otherIncomeUsd += flow.income;
    savedUsd += flow.savings;
  }

  // Bills still due before the next paycheck lands, from active recurring
  // templates -- money that's effectively already spoken for even though
  // it hasn't left an account yet.
  const upcomingTemplates = await prisma.recurringTemplate.findMany({
    where: {
      householdId: user.householdId,
      active: true,
      nextRunAt: { gt: now, lte: nextPaycheck },
      instrument: { archived: false },
    },
    include: { category: true, instrument: true },
  });

  const upcomingBills = upcomingTemplates
    .filter((t) => countsAsSpending(kindOf(t.category)))
    .map((t) => ({
      id: t.id,
      categoryName: t.category.name,
      instrumentName: t.instrument.name,
      amount: t.amount.toString(),
      currency: t.currency,
      nextRunAt: t.nextRunAt.toISOString(),
    }))
    .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());

  const upcomingCommittedUsd = upcomingBills.reduce(
    (sum, b) => sum + toApproxUsd(Number(b.amount), b.currency),
    0
  );

  const paycheckUsd = toApproxUsd(Number(lastPaycheck.amount), lastPaycheck.currency);
  // Money already moved to savings is no longer available to spend.
  const availableNowUsd = paycheckUsd + otherIncomeUsd - spentSoFarUsd - savedUsd;
  const availableAfterBillsUsd = availableNowUsd - upcomingCommittedUsd;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return NextResponse.json({
    hasData: true,
    lastPaycheck: {
      date: lastPaycheck.date.toISOString(),
      amount: lastPaycheck.amount.toString(),
      currency: lastPaycheck.currency,
      instrumentName: lastPaycheck.instrument.name,
    },
    nextPaycheck: {
      date: nextPaycheck.toISOString(),
      daysUntil: Math.max(0, daysUntil(now, nextPaycheck)),
    },
    spentSoFarUsd: round2(spentSoFarUsd),
    otherIncomeUsd: round2(otherIncomeUsd),
    upcomingBills,
    upcomingCommittedUsd: round2(upcomingCommittedUsd),
    availableNowUsd: round2(availableNowUsd),
    availableAfterBillsUsd: round2(availableAfterBillsUsd),
  });
}
