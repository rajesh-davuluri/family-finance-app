import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";
import { calendarDateInZone } from "@/lib/appTimezone";

// Month-by-month spending for the Dashboard's "Spending by month" section:
// for each of the last N months (current month included, so far), money
// spent and received, the net, and the category with the most spending.
// Amounts are approximate USD, like the rest of the Dashboard.

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 24;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const requested = Number(new URL(req.url).searchParams.get("months")) || DEFAULT_MONTHS;
  const count = Math.min(Math.max(requested, 1), MAX_MONTHS);

  // Transaction dates are stored as UTC midnight of their calendar day, so
  // UTC year/month is the calendar month. "This month" follows the
  // household's time zone.
  const [y, m] = calendarDateInZone().split("-").map(Number);
  const months: { year: number; month: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  const from = new Date(Date.UTC(months[0].year, months[0].month - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));

  const txns = await prisma.transaction.findMany({
    where: { householdId: user.householdId, date: { gte: from, lt: to } },
    select: { amount: true, currency: true, date: true, category: { select: { name: true, direction: true } } },
  });

  const buckets = new Map(
    months.map((mo) => [
      `${mo.year}-${mo.month}`,
      { ...mo, spent: 0, income: 0, count: 0, byCategory: new Map<string, number>() },
    ])
  );
  for (const t of txns) {
    const b = buckets.get(`${t.date.getUTCFullYear()}-${t.date.getUTCMonth() + 1}`);
    if (!b) continue;
    const usd = toApproxUsd(Number(t.amount), t.currency);
    if (t.category.direction === "INCOME") {
      b.income += usd;
    } else {
      b.spent += usd;
      b.count += 1;
      b.byCategory.set(t.category.name, (b.byCategory.get(t.category.name) ?? 0) + usd);
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const result = Array.from(buckets.values()).map((b, i, all) => {
    const top = Array.from(b.byCategory.entries()).sort((a, z) => z[1] - a[1])[0];
    const prev = i > 0 ? all[i - 1].spent : null;
    return {
      year: b.year,
      month: b.month,
      isCurrent: b.year === y && b.month === m,
      spent: round(b.spent),
      income: round(b.income),
      net: round(b.income - b.spent),
      transactions: b.count,
      topCategory: top ? { name: top[0], amount: round(top[1]) } : null,
      // Change in spending vs the month before; null when that month had none.
      changePct: prev ? Math.round(((b.spent - prev) / prev) * 100) : null,
    };
  });

  return NextResponse.json({ months: result });
}
