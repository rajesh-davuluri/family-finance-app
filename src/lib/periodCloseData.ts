import type { PaymentInstrument } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toApproxUsd } from "@/lib/fx";
import { loadCards } from "@/lib/cardData";
import { balanceItems, computeInstrumentBalance } from "@/lib/balanceCalculations";
import { findCauses, inTransit, transitText, type Hint } from "@/lib/balanceCheck";
import { money } from "@/lib/money";
import { cardCheckItems, cardCheckSince, cardsOwedOn } from "@/lib/cardCheckData";
import { addDays } from "@/lib/cards";
import { ADJUSTMENT_CATEGORY, DEFAULT_TOLERANCE_USD, closeStatus, lastMonthEnd, periodLabel, type AccountKind, type CloseStatus } from "@/lib/periodClose";

// Monthly close, server side: each account's latest period and where it
// stands, the app's own figure for a date, the likely causes of a
// difference, and the category adjustments are recorded in.

const day = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
export const kindOfAccount = (i: { type: string }): AccountKind => (i.type === "CREDIT_CARD" ? "CARD" : "BANK");

export async function toleranceUsd(householdId: string): Promise<number> {
  const h = await prisma.household.findUnique({ where: { id: householdId }, select: { closeToleranceUsd: true } });
  return h?.closeToleranceUsd != null ? Number(h.closeToleranceUsd) : DEFAULT_TOLERANCE_USD;
}

// What the app works out for an account on a date: a bank account's
// balance, or what's owed on a card. Null when it can't be worked out
// (no starting balance, a date before it, or a card without a closing day).
export async function appFigureOn(householdId: string, inst: PaymentInstrument, date: string, cardOwed?: Map<string, number | null>): Promise<number | null> {
  if (kindOfAccount(inst) === "CARD") return (cardOwed ?? (await cardsOwedOn(householdId, date))).get(inst.id) ?? null;
  if (inst.openingBalance === null || !inst.openingBalanceDate) return null;
  if (date < day(inst.openingBalanceDate)) return null;
  return computeInstrumentBalance(inst.id, Number(inst.openingBalance), inst.openingBalanceDate, new Date(`${date}T00:00:00Z`));
}

// Why an account can't be closed yet, if it can't.
export function unavailableReason(inst: PaymentInstrument, hasCycle: boolean): string | null {
  if (kindOfAccount(inst) === "CARD") return hasCycle ? null : "Set its statement closing day on Credit cards first.";
  return inst.openingBalance === null || !inst.openingBalanceDate ? "Set a starting balance on Accounts & cards first." : null;
}

// The likely causes of a difference, looking at this period's entries.
export async function closeCauses(inst: PaymentInstrument, date: string, diff: number, periodStart: string | null): Promise<Hint[]> {
  if (kindOfAccount(inst) === "CARD") {
    const since = periodStart && periodStart > cardCheckSince(date) ? periodStart : cardCheckSince(date);
    return findCauses({ diff, items: await cardCheckItems(inst.id, inst.currency, since, date), since, asOf: date, card: true });
  }
  const opening = day(inst.openingBalanceDate!);
  const since = periodStart && periodStart > opening ? periodStart : opening;
  return findCauses({ diff, items: await balanceItems(inst.id, new Date(`${opening}T00:00:00Z`)), since, asOf: date });
}

// A difference that's only entries made just before the date and posted
// after it: what to say about it, or null.
export async function closeTransit(inst: PaymentInstrument, date: string, diff: number, periodStart: string | null): Promise<string | null> {
  const card = kindOfAccount(inst) === "CARD";
  const opening = card ? null : day(inst.openingBalanceDate!);
  const since = card ? (periodStart && periodStart > cardCheckSince(date) ? periodStart : cardCheckSince(date)) : periodStart && periodStart > opening! ? periodStart : opening!;
  const items = card ? await cardCheckItems(inst.id, inst.currency, since, date) : (await balanceItems(inst.id, new Date(`${opening}T00:00:00Z`))).filter((i) => i.date >= since);
  const t = inTransit({ diff, items, asOf: date });
  return t ? transitText(t, (n) => money(n, inst.currency), card) : null;
}

// The category a balance adjustment is recorded in: one each way, made on
// first use. They count as neither income nor spending (kind TRANSFER).
export async function adjustmentCategoryId(householdId: string, direction: "INCOME" | "EXPENSE"): Promise<string> {
  const name = ADJUSTMENT_CATEGORY[direction];
  const existing = await prisma.transactionCategory.findUnique({ where: { householdId_name: { householdId, name } } });
  if (existing) return existing.id;
  const created = await prisma.transactionCategory.create({ data: { householdId, name, direction, kind: "TRANSFER", group: "TRANSFERS" } });
  return created.id;
}

export type CloseRow = {
  id: string;
  periodEnd: string;
  label: string;
  statementFigure: number;
  appFigure: number;
  adjustment: number;
  // Closed with entries still in transit: `adjustment` is that gap, and no
  // adjustment transaction was recorded -- the entries will post.
  inTransit: boolean;
  note: string | null;
  closedByName: string;
  closedAt: string;
};

export type CloseAccount = {
  id: string;
  name: string;
  last4: string | null;
  kind: AccountKind;
  currency: string;
  status: CloseStatus;
  reason: string | null; // why it can't be closed
  dueEnd: string | null; // end of the latest period that's over
  dueLabel: string | null;
  periodStart: string | null; // day after the last close
  earliestDate: string | null; // the first date it can be closed through
  latest: (CloseRow & { appNow: number | null; offNow: number }) | null; // re-tested now
  history: CloseRow[];
};

// Every bank account and card, with its latest period and where it stands.
// The latest close is re-tested against the records as they are now, so an
// entry changed after closing shows up.
export async function loadCloseOverview(householdId: string, today: string): Promise<{ toleranceUsd: number; accounts: CloseAccount[] }> {
  const [instruments, cards, closes, tolerance] = await Promise.all([
    prisma.paymentInstrument.findMany({ where: { householdId, archived: false, type: { in: ["BANK_ACCOUNT", "CREDIT_CARD"] } }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    loadCards(householdId, today),
    prisma.periodClose.findMany({ where: { instrument: { householdId } }, orderBy: { periodEnd: "desc" } }),
    toleranceUsd(householdId),
  ]);
  const snapshot = new Map(cards.map((c) => [c.id, c.snapshot]));
  const owedCache = new Map<string, Map<string, number | null>>();
  const owedOn = async (date: string) => {
    if (!owedCache.has(date)) owedCache.set(date, await cardsOwedOn(householdId, date));
    return owedCache.get(date)!;
  };

  const accounts: CloseAccount[] = [];
  for (const inst of instruments) {
    const kind = kindOfAccount(inst);
    const snap = snapshot.get(inst.id);
    const reason = unavailableReason(inst, !!snap?.hasCycle);
    const statementClose = kind === "CARD" && snap?.hasCycle ? snap.statement!.close : null;
    const dueEnd = kind === "CARD" ? statementClose : lastMonthEnd(today);
    const own = closes.filter((c) => c.instrumentId === inst.id);
    const rows: CloseRow[] = own.slice(0, 12).map((c) => ({
      id: c.id,
      periodEnd: day(c.periodEnd),
      label: periodLabel(kind, day(c.periodEnd), kind === "CARD" ? day(c.periodEnd) : null),
      statementFigure: Number(c.statementFigure),
      appFigure: Number(c.appFigure),
      adjustment: Number(c.adjustment),
      inTransit: Number(c.adjustment) !== 0 && !c.adjustmentTransactionId,
      note: c.note,
      closedByName: c.closedByName,
      closedAt: c.createdAt.toISOString(),
    }));

    let latest: CloseAccount["latest"] = null;
    if (rows[0]) {
      const appNow = reason ? null : await appFigureOn(householdId, inst, rows[0].periodEnd, kind === "CARD" ? await owedOn(rows[0].periodEnd) : undefined);
      // An in-transit gap is expected: only what's beyond it counts as off.
      const expected = rows[0].inTransit ? rows[0].adjustment : 0;
      latest = { ...rows[0], appNow, offNow: appNow == null ? 0 : r2(rows[0].statementFigure - appNow - expected) };
    }
    const opening = inst.openingBalanceDate ? day(inst.openingBalanceDate) : null;
    const status = closeStatus({
      available: !reason,
      dueEnd,
      startsAfterDue: kind === "BANK" && !!opening && !!dueEnd && opening > dueEnd,
      latest: latest ? { periodEnd: latest.periodEnd, stillMatches: latest.appNow == null || Math.abs(latest.offNow) < 0.005 } : null,
    });
    accounts.push({
      id: inst.id,
      name: inst.name,
      last4: inst.last4,
      kind,
      currency: inst.currency,
      status,
      reason,
      dueEnd,
      dueLabel: dueEnd ? periodLabel(kind, dueEnd, statementClose) : null,
      periodStart: rows[0] ? addDays(rows[0].periodEnd, 1) : null,
      earliestDate: rows[0] ? addDays(rows[0].periodEnd, 1) : kind === "BANK" ? opening : null,
      latest,
      history: rows,
    });
  }
  return { toleranceUsd: tolerance, accounts };
}

export const diffUsd = (diff: number, currency: string) => toApproxUsd(diff, currency);
