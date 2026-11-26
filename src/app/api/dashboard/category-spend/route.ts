import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { toApproxUsd } from "@/lib/fx";
import { SPEND_GROUPS, summarizeSpend } from "@/lib/categorySpend";

// Groceries, food and car gas: spent this month and this year (approx USD
// when some of it is in rupees), for the dashboard tiles.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const today = calendarDateInZone();
  const y = Number(today.slice(0, 4));
  // From last December, so January can compare with the month before.
  const from = new Date(Date.UTC(y - 1, 11, 1));

  const categories = await prisma.transactionCategory.findMany({
    where: { householdId: user.householdId, direction: "EXPENSE" },
    select: { id: true, name: true },
  });
  const counted = categories.filter((c) => SPEND_GROUPS.some((g) => g.match.test(c.name.trim())));
  const txns = counted.length
    ? await prisma.transaction.findMany({
        where: { householdId: user.householdId, categoryId: { in: counted.map((c) => c.id) }, date: { gte: from } },
        select: { date: true, amount: true, currency: true, categoryId: true },
      })
    : [];
  const nameOf = new Map(counted.map((c) => [c.id, c.name]));
  const rows = txns.map((t) => ({
    date: t.date.toISOString().slice(0, 10),
    usd: toApproxUsd(Number(t.amount), t.currency),
    categoryName: nameOf.get(t.categoryId) ?? "",
  }));
  const mixed = txns.some((t) => t.currency !== "USD");

  return NextResponse.json({ today, mixedCurrency: mixed, groups: summarizeSpend(rows, today, categories.map((c) => c.name)) });
}
