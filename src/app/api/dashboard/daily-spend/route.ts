import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { toApproxUsd } from "@/lib/fx";
import { countsAsSpending, flowOf, kindOf } from "@/lib/categoryKind";

// Spending added up day by day, this month (to today) and last month (all
// of it), for the dashboard's "this month vs last" line. Approx USD.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const from = new Date(Date.UTC(y, m - 2, 1));
  const to = new Date(Date.UTC(y, m - 1, d + 1));

  const txns = await prisma.transaction.findMany({
    where: { householdId: user.householdId, date: { gte: from, lt: to } },
    select: { amount: true, currency: true, date: true, category: { select: { name: true, direction: true, kind: true } } },
  });

  const daysThis = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysLast = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const thisDaily = new Array(daysThis).fill(0);
  const lastDaily = new Array(daysLast).fill(0);
  for (const t of txns) {
    const kind = kindOf(t.category);
    if (!countsAsSpending(kind)) continue;
    const spend = flowOf(kind, toApproxUsd(Number(t.amount), t.currency)).spending;
    const isThis = t.date.getUTCMonth() === m - 1;
    (isThis ? thisDaily : lastDaily)[t.date.getUTCDate() - 1] += spend;
  }
  const cumulative = (xs: number[], upto: number) => {
    const out: number[] = [];
    let s = 0;
    for (let i = 0; i < upto; i++) out.push(Math.round((s += xs[i]) * 100) / 100);
    return out;
  };
  return NextResponse.json({
    today: d,
    daysInMonth: daysThis,
    thisMonth: cumulative(thisDaily, d),
    lastMonth: cumulative(lastDaily, daysLast),
  });
}
