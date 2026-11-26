import { prisma } from "@/lib/prisma";
import { toApproxUsd } from "@/lib/fx";
import { kindOf } from "@/lib/categoryKind";
import { HistoryTxn, detectRecurring } from "@/lib/recurringDetect";

// Loads about a year of history for a household and runs recurring-bill
// detection on it (src/lib/recurringDetect.ts). Shared by the Recurring and
// Paychecks APIs.

const HISTORY_DAYS = 400;
const MAX_ROWS = 10000;

export async function detectHouseholdRecurring(householdId: string, today: string) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - HISTORY_DAYS * 86_400_000);
  const rows = await prisma.transaction.findMany({
    where: { householdId, date: { gte: from } },
    select: {
      id: true,
      date: true,
      amount: true,
      currency: true,
      notes: true,
      categoryId: true,
      category: { select: { name: true, direction: true, kind: true } },
      instrument: { select: { name: true } },
    },
    orderBy: { date: "desc" },
    take: MAX_ROWS,
  });
  const history: HistoryTxn[] = rows.map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    amount: Number(t.amount),
    currency: t.currency,
    usd: Math.round(toApproxUsd(Number(t.amount), t.currency) * 100) / 100,
    notes: t.notes,
    categoryId: t.categoryId,
    categoryName: t.category.name,
    kind: kindOf(t.category),
    instrumentName: t.instrument.name,
  }));
  return detectRecurring(history, today);
}
