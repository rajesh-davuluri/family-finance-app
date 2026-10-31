import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// "When did we last record anything?" -- covers every transaction, whether
// entered by hand or imported from a statement. Returns the most recently
// added transaction, plus per account its latest transaction (by date) and
// when something was last added to it.
type TxnWithRelations = Awaited<ReturnType<typeof findLatest>>;

function findLatest(where: { householdId: string; instrumentId?: string }, orderBy: "added" | "dated") {
  return prisma.transaction.findFirst({
    where,
    orderBy: orderBy === "added" ? { createdAt: "desc" } : [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      category: { select: { name: true, direction: true } },
      instrument: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
}

function serialize(t: NonNullable<TxnWithRelations>) {
  return {
    createdAt: t.createdAt.toISOString(),
    date: t.date.toISOString(),
    amount: Number(t.amount),
    currency: t.currency,
    notes: t.notes,
    categoryName: t.category.name,
    direction: t.category.direction,
    instrumentName: t.instrument.name,
    createdByName: t.createdBy.name,
    source: t.importBatchId ? ("IMPORTED" as const) : t.recurringTemplateId ? ("RECURRING" as const) : ("MANUAL" as const),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [last, grouped, instruments] = await Promise.all([
    findLatest({ householdId: user.householdId }, "added"),
    prisma.transaction.groupBy({
      by: ["instrumentId"],
      where: { householdId: user.householdId },
      _max: { date: true, createdAt: true },
      _count: { _all: true },
    }),
    prisma.paymentInstrument.findMany({
      where: { householdId: user.householdId, archived: false },
      select: { id: true, name: true, type: true, last4: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const byInstrument = new Map(grouped.map((g) => [g.instrumentId, g]));

  // One small query per account -- households have a handful of them.
  const latestPerInstrument = await Promise.all(
    instruments.map((i) => findLatest({ householdId: user.householdId, instrumentId: i.id }, "dated"))
  );

  return NextResponse.json({
    lastAdded: last ? serialize(last) : null,
    instruments: instruments.map((i, idx) => {
      const g = byInstrument.get(i.id);
      return {
        id: i.id,
        name: i.name,
        type: i.type,
        last4: i.last4,
        transactionCount: g?._count._all ?? 0,
        latestTransactionDate: g?._max.date?.toISOString() ?? null,
        lastAddedAt: g?._max.createdAt?.toISOString() ?? null,
        latestTransaction: latestPerInstrument[idx] ? serialize(latestPerInstrument[idx]!) : null,
      };
    }),
  });
}
