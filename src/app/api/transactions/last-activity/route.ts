import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// "When did we last record anything?" -- for a household that catches up by
// importing statements rather than logging as it goes. Returns the most
// recently added transaction, plus per account the latest transaction date
// on record (how far its statements have been imported) and when something
// was last added to it.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [last, grouped, instruments] = await Promise.all([
    prisma.transaction.findFirst({
      where: { householdId: user.householdId },
      orderBy: { createdAt: "desc" },
      include: {
        category: { select: { name: true, direction: true } },
        instrument: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    }),
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

  return NextResponse.json({
    lastAdded: last
      ? {
          createdAt: last.createdAt.toISOString(),
          date: last.date.toISOString(),
          amount: Number(last.amount),
          currency: last.currency,
          notes: last.notes,
          categoryName: last.category.name,
          direction: last.category.direction,
          instrumentName: last.instrument.name,
          createdByName: last.createdBy.name,
        }
      : null,
    instruments: instruments.map((i) => {
      const g = byInstrument.get(i.id);
      return {
        id: i.id,
        name: i.name,
        type: i.type,
        last4: i.last4,
        transactionCount: g?._count._all ?? 0,
        latestTransactionDate: g?._max.date?.toISOString() ?? null,
        lastAddedAt: g?._max.createdAt?.toISOString() ?? null,
      };
    }),
  });
}
