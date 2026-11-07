import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { sourceOf } from "@/lib/lastActivity";
import { kindOf } from "@/lib/categoryKind";
import { groupOf } from "@/lib/categoryGroups";
import type { CardCheck, ReportTransaction } from "@/lib/reports";

// Data for the Reports page: every transaction in a period (optionally one
// account / one category), plus a per-credit-card statement check -- owed at
// the start, purchases, refunds, payments and owed at the end -- to compare
// with the bank's statement. The reports themselves are built in the
// browser from this (src/lib/reports.ts).

const MAX_TRANSACTIONS = 5000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || from > to) {
    return NextResponse.json({ error: "Pick a valid period (from on or before to)." }, { status: 400 });
  }
  const instrumentId = params.get("instrumentId") || undefined;
  const categoryId = params.get("categoryId") || undefined;

  // Transaction dates are stored as UTC midnight of their calendar day.
  const start = new Date(`${from}T00:00:00Z`);
  const endExclusive = new Date(`${to}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const rows = await prisma.transaction.findMany({
    where: {
      householdId: user.householdId,
      date: { gte: start, lt: endExclusive },
      ...(instrumentId ? { instrumentId } : {}),
      ...(categoryId ? { categoryId } : {}),
    },
    include: {
      category: { select: { name: true, direction: true, kind: true, group: true } },
      instrument: { select: { name: true } },
      createdBy: { select: { name: true } },
      importBatch: { select: { fileName: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: MAX_TRANSACTIONS + 1,
  });

  const transactions: ReportTransaction[] = rows.slice(0, MAX_TRANSACTIONS).map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    amount: Number(t.amount),
    currency: t.currency,
    usd: Math.round(toApproxUsd(Number(t.amount), t.currency) * 100) / 100,
    notes: t.notes,
    categoryId: t.categoryId,
    categoryName: t.category.name,
    direction: t.category.direction === "INCOME" ? "INCOME" : "EXPENSE",
    kind: kindOf(t.category),
    group: groupOf(t.category),
    instrumentId: t.instrumentId,
    instrumentName: t.instrument.name,
    source: sourceOf(t),
    createdByName: t.createdBy.name,
  }));

  // Card check, in each card's own currency.
  const cards = await prisma.paymentInstrument.findMany({
    where: {
      householdId: user.householdId,
      type: "CREDIT_CARD",
      archived: false,
      ...(instrumentId ? { id: instrumentId } : {}),
    },
    orderBy: { name: "asc" },
  });
  const beforeStart = new Date(start.getTime() - 1);
  const endOfPeriod = new Date(endExclusive.getTime() - 1);
  const cardChecks: CardCheck[] = await Promise.all(
    cards.map(async (c) => {
      const hasOpening = c.openingBalance !== null && c.openingBalanceDate !== null;
      const balanceAt = (asOf: Date) =>
        hasOpening
          ? computeInstrumentBalance(c.id, Number(c.openingBalance), c.openingBalanceDate!, asOf)
          : computeInstrumentBalance(c.id, 0, new Date(0), asOf);
      const inPeriod = { gte: start, lt: endExclusive };
      const [atStart, atEnd, txns, transfersIn, transfersOut] = await Promise.all([
        balanceAt(beforeStart),
        balanceAt(endOfPeriod),
        prisma.transaction.findMany({
          where: { instrumentId: c.id, currency: c.currency, date: inPeriod },
          select: { amount: true, category: { select: { direction: true } } },
        }),
        prisma.transfer.findMany({ where: { toInstrumentId: c.id, currency: c.currency, date: inPeriod }, select: { amount: true } }),
        prisma.transfer.findMany({ where: { fromInstrumentId: c.id, currency: c.currency, date: inPeriod }, select: { amount: true } }),
      ]);
      const sum = (xs: { amount: unknown }[]) => Math.round(xs.reduce((s, x) => s + Number(x.amount), 0) * 100) / 100;
      const purchases = txns.filter((t) => t.category.direction !== "INCOME");
      return {
        id: c.id,
        name: c.name,
        last4: c.last4,
        currency: c.currency,
        // Balances are negative when money is owed on the card.
        owedAtStart: Math.round(-atStart * 100) / 100,
        purchases: sum(purchases),
        refunds: sum(txns.filter((t) => t.category.direction === "INCOME")),
        payments: sum(transfersIn),
        otherTransfersOut: sum(transfersOut),
        owedAtEnd: Math.round(-atEnd * 100) / 100,
        purchaseCount: purchases.length,
        basedOnTransactionsOnly: !hasOpening,
      };
    })
  );

  return NextResponse.json({
    from,
    to,
    transactions,
    truncated: rows.length > MAX_TRANSACTIONS,
    cards: cardChecks,
  });
}
