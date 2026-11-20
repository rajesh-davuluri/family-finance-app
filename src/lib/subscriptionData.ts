import { prisma } from "@/lib/prisma";
import { toApproxUsd } from "@/lib/fx";
import { kindOf } from "@/lib/categoryKind";
import { detectRecurring, merchantOf } from "@/lib/recurringDetect";
import { findSubscriptions, type MarkStatus, type SubscriptionTxn } from "@/lib/subscriptions";

// Loads a year of the household's transactions and its Keep/Cancel marks,
// and finds its subscriptions (src/lib/subscriptions.ts).

const HISTORY_DAYS = 400;
const MAX_ROWS = 10000;

export async function loadSubscriptions(householdId: string, today: string) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - HISTORY_DAYS * 86_400_000);
  const [rows, marks, templates] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId, date: { gte: from } },
      select: {
        id: true,
        date: true,
        amount: true,
        currency: true,
        notes: true,
        categoryId: true,
        instrumentId: true,
        category: { select: { name: true, direction: true, kind: true } },
        instrument: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: MAX_ROWS,
    }),
    prisma.subscriptionMark.findMany({ where: { householdId } }),
    prisma.recurringTemplate.findMany({ where: { householdId, active: true }, select: { notes: true } }),
  ]);
  const history: SubscriptionTxn[] = rows.map((t) => ({
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
    instrumentId: t.instrumentId,
  }));
  const { bills } = detectRecurring(history, today);
  const recurringKeys = new Set(templates.map((t) => merchantOf(t.notes)).filter((m): m is string => !!m).map((m) => `m:${m}`));
  return findSubscriptions({
    bills,
    history,
    marks: marks.map((m) => ({ key: m.key, status: m.status as MarkStatus, amount: m.amount == null ? null : Number(m.amount), markedAt: m.markedAt.toISOString() })),
    recurringKeys,
    today,
  });
}
