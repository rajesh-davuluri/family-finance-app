import { prisma } from "@/lib/prisma";
import { kindOf } from "@/lib/categoryKind";
import { toApproxUsd } from "@/lib/fx";
import { findFees, type Fee } from "@/lib/fees";

// Fees & interest in the last few months (src/lib/fees.ts), for Needs
// attention. Only transactions whose wording or category could be a fee are
// read.

const WORDS = ["FEE", "INTEREST", "FINANCE CHARGE", "OVERDRAFT", "NSF", "INSUFFICIENT", "SERVICE CHARGE", "MAINTENANCE CHARGE", "LATE CHARGE"];

export async function loadRecentFees(householdId: string, today: string, days = 120): Promise<Fee[]> {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000);
  const rows = await prisma.transaction.findMany({
    where: {
      householdId,
      date: { gte: from },
      OR: [...WORDS.map((w) => ({ notes: { contains: w } })), { category: { name: { contains: "fee" } } }, { category: { name: { contains: "interest" } } }],
    },
    select: {
      id: true,
      date: true,
      notes: true,
      amount: true,
      currency: true,
      instrumentId: true,
      instrument: { select: { name: true } },
      category: { select: { name: true, direction: true, kind: true } },
    },
  });
  return findFees(
    rows.map((t) => ({
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      notes: t.notes,
      categoryName: t.category.name,
      direction: t.category.direction === "INCOME" ? "INCOME" : "EXPENSE",
      kind: kindOf(t.category),
      instrumentId: t.instrumentId,
      instrumentName: t.instrument.name,
      amount: Number(t.amount),
      currency: t.currency,
      usd: Math.round(toApproxUsd(Number(t.amount), t.currency) * 100) / 100,
    })),
  );
}
