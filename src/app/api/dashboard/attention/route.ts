import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { toApproxUsd } from "@/lib/fx";
import { loadCards } from "@/lib/cardData";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { loadForDuplicateCheck, pairKey, settledPairs } from "@/lib/duplicateData";
import { findPairs } from "@/lib/duplicates";
import { attentionItems } from "@/lib/attention";

// The dashboard's "Needs attention" strip.

const STALE_DAYS = 14; // no new transaction on an account for this long
const DORMANT_DAYS = 120; // ...but it was in use within this long (not a dormant account)
const DAY = 86_400_000;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const householdId = user.householdId;
  const today = calendarDateInZone();
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00Z`);

  const [cards, instruments, budgets, monthTxns, latest, dupTxns, settled] = await Promise.all([
    loadCards(householdId, today),
    prisma.paymentInstrument.findMany({ where: { householdId, archived: false } }),
    prisma.budget.findMany({ where: { householdId }, include: { category: true } }),
    prisma.transaction.findMany({
      where: { householdId, date: { gte: monthStart }, category: { direction: "EXPENSE" } },
      select: { categoryId: true, amount: true, currency: true },
    }),
    prisma.transaction.groupBy({ by: ["instrumentId"], where: { householdId }, _max: { date: true } }),
    loadForDuplicateCheck(householdId, new Date(todayMs - 180 * DAY).toISOString().slice(0, 10), today),
    settledPairs(householdId),
  ]);

  // Bank money (USD accounts with a balance set) against USD card bills.
  let bankUsd: number | null = null;
  for (const b of instruments.filter((i) => i.type === "BANK_ACCOUNT" && i.currency === "USD" && i.openingBalance !== null && i.openingBalanceDate)) {
    bankUsd = (bankUsd ?? 0) + (await computeInstrumentBalance(b.id, Number(b.openingBalance), b.openingBalanceDate!));
  }
  // Only bills due before the next biweekly paycheck could leave the bank
  // short; later ones are paid from that paycheck.
  const cardBillsUsd = cards
    .filter((c) => c.currency === "USD" && c.snapshot.daysToDue != null && c.snapshot.daysToDue <= 14)
    .reduce((t, c) => t + c.snapshot.leftOnStatement, 0);

  const spent = new Map<string, number>();
  for (const t of monthTxns) spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + toApproxUsd(Number(t.amount), t.currency));

  const split = new Map(dupTxns.map((t) => [t.id, !!t.splitGroupId]));
  const likelyDuplicates = findPairs(dupTxns, (a, b) => settled.has(pairKey(a, b))).filter(
    (p) => p.confidence === "HIGH" && !(split.get(p.keep) && split.get(p.remove)) && !settled.has(pairKey(p.keep, p.remove)),
  ).length;

  const lastBy = new Map(latest.map((l) => [l.instrumentId, l._max.date]));
  const stale = instruments
    .filter((i) => i.type === "BANK_ACCOUNT" || i.type === "CREDIT_CARD")
    .map((i) => ({ name: i.name, last: lastBy.get(i.id) }))
    .filter((x): x is { name: string; last: Date } => !!x.last)
    .map((x) => ({ name: x.name, lastDate: x.last.toISOString().slice(0, 10), days: Math.round((todayMs - x.last.getTime()) / DAY) }))
    .filter((x) => x.days >= STALE_DAYS && x.days <= DORMANT_DAYS)
    .sort((a, b) => b.days - a.days);

  const items = attentionItems({
    cards: cards.map((c) => ({ name: c.name, currency: c.currency, leftOnStatement: c.snapshot.leftOnStatement, daysToDue: c.snapshot.daysToDue })),
    budgets: budgets.map((b) => ({ name: b.category.name, limit: Number(b.monthlyLimit), spent: spent.get(b.categoryId) ?? 0 })),
    bankUsd,
    cardBillsUsd,
    likelyDuplicates,
    stale,
  });
  return NextResponse.json({ items });
}
