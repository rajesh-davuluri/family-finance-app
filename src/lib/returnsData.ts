import { prisma } from "@/lib/prisma";
import { kindOf } from "@/lib/categoryKind";
import { toApproxUsd } from "@/lib/fx";
import { matchRefunds, refundsOwed, returnStatus, type Credit, type ReturnStatus, type ReturnTxn } from "@/lib/returns";

// Returns, server side: every purchase with a return window or a return in
// progress, newly arrived refunds paired with them (and saved), and each
// one's status (src/lib/returns.ts).

const day = (d: Date) => d.toISOString().slice(0, 10);
const MAX = 200;

export type ReturnItem = ReturnTxn & { categoryId: string; name: string; status: ReturnStatus | null; refund: { id: string; date: string; amount: number } | null };

export async function loadReturns(householdId: string, today: string): Promise<{ items: ReturnItem[]; owedUsd: number }> {
  const rows = await prisma.transaction.findMany({
    where: { householdId, OR: [{ returnState: { not: null } }, { returnBy: { not: null } }] },
    include: { category: { select: { name: true } }, instrument: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: MAX,
  });
  const returns: (ReturnTxn & { categoryId: string; name: string })[] = rows.map((t) => ({
    id: t.id,
    date: day(t.date),
    notes: t.notes,
    amount: Number(t.amount),
    currency: t.currency,
    instrumentId: t.instrumentId,
    instrumentName: t.instrument.name,
    returnBy: t.returnBy ? day(t.returnBy) : null,
    returnState: (t.returnState as ReturnTxn["returnState"]) ?? null,
    returnSentOn: t.returnSentOn ? day(t.returnSentOn) : null,
    returnExpected: t.returnExpected == null ? null : Number(t.returnExpected),
    refundTxnId: t.refundTxnId,
    categoryId: t.categoryId,
    name: t.notes?.trim() || t.category.name,
  }));

  // Pair refunds that have arrived with the returns waiting for them.
  const waiting = returns.filter((r) => r.returnState === "RETURNING" && !r.refundTxnId);
  if (waiting.length) {
    const since = new Date(`${waiting.map((r) => r.date).sort()[0]}T00:00:00Z`);
    const creditRows = await prisma.transaction.findMany({
      where: { householdId, date: { gte: since }, category: { direction: "INCOME" } },
      select: { id: true, date: true, notes: true, amount: true, currency: true, instrumentId: true, category: { select: { name: true, direction: true, kind: true } } },
    });
    const credits: Credit[] = creditRows
      .filter((c) => ["REFUND", "INCOME"].includes(kindOf(c.category)))
      .map((c) => ({ id: c.id, date: day(c.date), notes: c.notes, amount: Number(c.amount), currency: c.currency, instrumentId: c.instrumentId }));
    for (const m of matchRefunds(returns, credits)) {
      await prisma.transaction.update({ where: { id: m.returnId }, data: { returnState: "REFUNDED", refundTxnId: m.refundId } });
      const r = returns.find((x) => x.id === m.returnId)!;
      r.returnState = "REFUNDED";
      r.refundTxnId = m.refundId;
    }
  }

  // The refunds paired with them.
  const refundIds = returns.map((r) => r.refundTxnId).filter((x): x is string => !!x);
  const refunds = new Map(
    (await prisma.transaction.findMany({ where: { id: { in: refundIds }, householdId }, select: { id: true, date: true, amount: true } })).map((t) => [t.id, { id: t.id, date: day(t.date), amount: Number(t.amount) }]),
  );

  const items: ReturnItem[] = returns.map((r) => {
    const refund = r.refundTxnId ? refunds.get(r.refundTxnId) ?? null : null;
    // A refund that was deleted: waiting again.
    const fixed = r.returnState === "REFUNDED" && !refund ? { ...r, returnState: "RETURNING" as const, refundTxnId: null } : r;
    return { ...fixed, refund, status: returnStatus(fixed, refund, today) };
  });
  // Still owed back, in approx USD.
  const owedUsd = Math.round(items.reduce((n, i) => n + toApproxUsd(refundsOwed([i]), i.currency), 0) * 100) / 100;
  return { items, owedUsd };
}
