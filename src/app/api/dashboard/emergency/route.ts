import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { toApproxUsd } from "@/lib/fx";
import { kindOf, countsAsSpending, flowOf } from "@/lib/categoryKind";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { emergencyFund, isEssential } from "@/lib/emergencyFund";

// The emergency fund: dollars in US bank accounts against the household's
// essential spending, averaged over the last six full months.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const target = Number(new URL(req.url).searchParams.get("target")) === 6 ? 6 : 3;
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

  let cashUsd = 0;
  let inrAbroad = 0;
  const counted: string[] = [];
  const notSet: string[] = [];
  for (const b of banks) {
    if (b.openingBalance === null || !b.openingBalanceDate) {
      notSet.push(b.name);
      continue;
    }
    const bal = await computeInstrumentBalance(b.id, Number(b.openingBalance), b.openingBalanceDate);
    if (b.currency === "USD") {
      cashUsd += bal;
      counted.push(b.name);
    } else if (b.currency === "INR") inrAbroad += bal; // money in India isn't at hand for US bills
  }

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
    cashUsd: Math.round(cashUsd * 100) / 100,
    accounts: counted,
    accountsWithoutBalance: notSet,
    inrInIndia: Math.round(inrAbroad * 100) / 100,
    monthsAveraged: used.length,
    ...emergencyFund({ cashUsd, months: used, targetMonths: target }),
  });
}
