import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Combines recent Transactions and Transfers into one feed so household
// members can see who added what recently. DebtPayments don't record who
// logged them (no createdById on that model), so they're not included here
// -- everything shown does have a real "added by" to display.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [transactions, transfers] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId: user.householdId },
      include: { category: true, instrument: true, createdBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.transfer.findMany({
      where: { householdId: user.householdId },
      include: { fromInstrument: true, toInstrument: true, createdBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  const items = [
    ...transactions.map((t) => ({
      id: `txn-${t.id}`,
      type: "transaction" as const,
      createdAt: t.createdAt,
      createdByName: t.createdBy.name,
      direction: t.category.direction,
      amount: Number(t.amount),
      currency: t.currency,
      description: `${t.category.name} · ${t.instrument.name}`,
      date: t.date,
    })),
    ...transfers.map((t) => ({
      id: `xfr-${t.id}`,
      type: "transfer" as const,
      createdAt: t.createdAt,
      createdByName: t.createdBy.name,
      direction: "TRANSFER" as const,
      amount: Number(t.amount),
      currency: t.currency,
      description: `${t.fromInstrument.name} → ${t.toInstrument.name}`,
      date: t.date,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 15);

  return NextResponse.json(items);
}
