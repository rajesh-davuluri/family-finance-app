import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { toApproxUsd } from "@/lib/fx";
import { kindOf, countsAsSpending, flowOf } from "@/lib/categoryKind";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { emergencyFund, isEssential } from "@/lib/emergencyFund";

// The emergency fund: money set aside for emergencies against the
// household's essential spending, averaged over the last six full months.
// The fund is a US bank account named "Emergency..." when there is one (its
// live balance), else the amount typed in on the dashboard. Checking
// accounts are shown for context but not counted: that money pays the bills.
const EMERGENCY_ACCOUNT = /emergency/i;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const household = await prisma.household.findUnique({ where: { id: user.householdId }, select: { emergencyFundUsd: true, emergencyTargetMonths: true } });
  const target = household?.emergencyTargetMonths ?? 6;
  const today = calendarDateInZone();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const from = new Date(Date.UTC(y, m - 7, 1));
  const to = new Date(Date.UTC(y, m - 1, 1)); // this month is partial: left out

  const [banks, txns] = await Promise.all([
    prisma.paymentInstrument.findMany({ where: { householdId: user.householdId, archived: false, type: "BANK_ACCOUNT" } }),
    prisma.transaction.findMany({
      where: { householdId: user.householdId, date: { gte: from, lt: to } },
      select: { amount: true, currency: true, date: true, category: { select: { name: true, direction: true, kind: true } } },
    }),
  ]);

  let fromAccounts = 0;
  let checkingUsd = 0;
  let inrAbroad = 0;
  const fundAccounts: string[] = [];
  for (const b of banks) {
    if (b.openingBalance === null || !b.openingBalanceDate) continue;
    const bal = await computeInstrumentBalance(b.id, Number(b.openingBalance), b.openingBalanceDate);
    if (b.currency === "USD" && EMERGENCY_ACCOUNT.test(b.name)) {
      fromAccounts += bal;
      fundAccounts.push(b.name);
    } else if (b.currency === "USD") checkingUsd += bal;
    else if (b.currency === "INR") inrAbroad += bal; // money in India isn't at hand for US bills
  }
  const entered = household?.emergencyFundUsd != null ? Number(household.emergencyFundUsd) : null;
  const source = fundAccounts.length ? "account" : entered != null ? "entered" : "none";
  const cashUsd = source === "account" ? fromAccounts : (entered ?? 0);

  const months = new Map<string, { essentials: number; total: number }>();
  for (let i = 6; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.set(d.toISOString().slice(0, 7), { essentials: 0, total: 0 });
  }
  for (const t of txns) {
    const b = months.get(t.date.toISOString().slice(0, 7));
    if (!b) continue;
    const kind = kindOf(t.category);
    if (!countsAsSpending(kind)) continue;
    const spend = flowOf(kind, toApproxUsd(Number(t.amount), t.currency)).spending;
    b.total += spend;
    if (isEssential(kind, t.category.name)) b.essentials += spend;
  }
  // Months before the household's records began would drag the average down.
  const used = [...months.values()].filter((x) => x.total > 0);

  return NextResponse.json({
    targetMonths: target,
    source,
    cashUsd: Math.round(cashUsd * 100) / 100,
    fundAccounts,
    checkingUsd: Math.round(checkingUsd * 100) / 100,
    inrInIndia: Math.round(inrAbroad * 100) / 100,
    monthsAveraged: used.length,
    ...emergencyFund({ cashUsd, months: used, targetMonths: target }),
  });
}

// The typed-in amount set aside, and the target in months.
const schema = z.object({
  fundUsd: z.number().min(0).max(10_000_000).nullable().optional(),
  targetMonths: z.number().int().min(1).max(24).optional(),
});

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the amount." }, { status: 400 });
  const { fundUsd, targetMonths } = parsed.data;
  await prisma.household.update({
    where: { id: user.householdId },
    data: {
      ...(fundUsd !== undefined ? { emergencyFundUsd: fundUsd } : {}),
      ...(targetMonths !== undefined ? { emergencyTargetMonths: targetMonths } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
