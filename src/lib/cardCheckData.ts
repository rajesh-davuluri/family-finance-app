import { prisma } from "@/lib/prisma";
import { kindOf } from "@/lib/categoryKind";
import { loadCards } from "@/lib/cardData";
import { addDays, classifyCardTransaction, dedupePayments, type CardActivity } from "@/lib/cards";
import { isMatch, type CheckItem } from "@/lib/balanceCheck";
import type { CheckStatus } from "@/lib/balanceCheckData";

// Checking a credit card against the card's own balance: what the app works
// out as owed on a date (the same figure as "Owed now" on Credit cards), the
// card's entries around then for finding a difference, and each card's
// latest check re-tested. Checks are kept in the BalanceCheck table, with
// the card's figure as bankBalance.

const day = (d: Date) => d.toISOString().slice(0, 10);

// Owed on each card as of a date; null for a card without a statement cycle.
export async function cardsOwedOn(householdId: string, date: string): Promise<Map<string, number | null>> {
  const cards = await loadCards(householdId, date);
  return new Map(cards.map((c) => [c.id, c.snapshot.hasCycle ? c.snapshot.outstanding : null]));
}

// The card's entries from `since` to `asOf`, signed by their effect on what's
// owed (a charge positive, a payment or refund negative), with a payment that
// arrived both as a bank transfer and as a card credit counted once -- as
// the card's balance does.
export async function cardCheckItems(cardId: string, currency: string, since: string, asOf: string): Promise<CheckItem[]> {
  const between = { gte: new Date(`${since}T00:00:00Z`), lte: new Date(`${asOf}T00:00:00Z`) };
  const [txns, transfersIn, transfersOut] = await Promise.all([
    prisma.transaction.findMany({ where: { instrumentId: cardId, currency, date: between }, include: { category: true } }),
    prisma.transfer.findMany({ where: { toInstrumentId: cardId, currency, date: between }, include: { fromInstrument: { select: { name: true } } } }),
    prisma.transfer.findMany({ where: { fromInstrumentId: cardId, currency, date: between }, include: { toInstrument: { select: { name: true } } } }),
  ]);
  type Row = CardActivity & { id: string; itemKind: CheckItem["kind"]; notes: string | null };
  const rows: Row[] = [
    ...txns.map((t) => ({
      id: t.id,
      itemKind: "TRANSACTION" as const,
      notes: t.notes,
      date: day(t.date),
      amount: Number(t.amount),
      kind: classifyCardTransaction(t.category.direction === "INCOME" ? "INCOME" : "EXPENSE", kindOf(t.category), `${t.category.name} ${t.notes ?? ""}`),
      source: "CARD" as const,
      label: t.category.name,
    })),
    ...transfersIn.map((t) => ({ id: t.id, itemKind: "TRANSFER" as const, notes: t.notes, date: day(t.date), amount: Number(t.amount), kind: "PAYMENT" as const, source: "TRANSFER" as const, label: `Payment from ${t.fromInstrument.name}` })),
    ...transfersOut.map((t) => ({ id: t.id, itemKind: "TRANSFER" as const, notes: t.notes, date: day(t.date), amount: Number(t.amount), kind: "CHARGE" as const, source: "CARD" as const, label: `Moved to ${t.toInstrument.name}` })),
  ];
  const kept = dedupePayments(rows).activity as Row[];
  return kept
    .map((r) => ({ id: r.id, kind: r.itemKind, date: r.date, label: r.label, notes: r.notes, amount: r.kind === "CHARGE" ? r.amount : -r.amount }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// How far back to look for the cause of a difference.
export const CARD_LOOKBACK_DAYS = 90;
export const cardCheckSince = (asOf: string) => addDays(asOf, -CARD_LOOKBACK_DAYS);

// The latest check on each active card, re-tested against the records now.
export async function loadCardCheckStatuses(householdId: string): Promise<Map<string, CheckStatus>> {
  const out = new Map<string, CheckStatus>();
  const checks = await prisma.balanceCheck.findMany({
    where: { instrument: { householdId, type: "CREDIT_CARD", archived: false } },
    orderBy: { createdAt: "desc" },
  });
  const latest = new Map<string, (typeof checks)[number]>();
  for (const c of checks) if (!latest.has(c.instrumentId)) latest.set(c.instrumentId, c);
  if (!latest.size) return out;

  // One pass over the cards for each date checked.
  const owedByDate = new Map<string, Map<string, number | null>>();
  for (const c of latest.values()) {
    const d = day(c.asOfDate);
    if (!owedByDate.has(d)) owedByDate.set(d, await cardsOwedOn(householdId, d));
  }
  for (const [id, c] of latest) {
    const d = day(c.asOfDate);
    const app = owedByDate.get(d)?.get(id);
    if (app == null) continue;
    const bank = Number(c.bankBalance);
    out.set(id, {
      asOfDate: d,
      checkedAt: c.createdAt.toISOString(),
      bankBalance: bank,
      appBalance: app,
      diff: Math.round((bank - app) * 100) / 100,
      matched: isMatch(bank, app),
      adjusted: false,
      daysSince: Math.floor((Date.now() - c.createdAt.getTime()) / 86_400_000),
    });
  }
  return out;
}
