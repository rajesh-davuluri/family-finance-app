import { prisma } from "@/lib/prisma";
import { sourceOf } from "@/lib/lastActivity";
import { DUPLICATE_WINDOW_DAYS, DupMatch, DupTxn, findDuplicate } from "@/lib/duplicates";

// Database side of duplicate detection (src/lib/duplicates.ts): loads a
// household's transactions around some dates in the shape the matcher uses.

const DAY = 86_400_000;

export async function loadForDuplicateCheck(householdId: string, fromDate: string, toDate: string) {
  const from = new Date(Date.parse(`${fromDate}T00:00:00Z`) - DUPLICATE_WINDOW_DAYS * DAY);
  const to = new Date(Date.parse(`${toDate}T00:00:00Z`) + (DUPLICATE_WINDOW_DAYS + 1) * DAY);
  const rows = await prisma.transaction.findMany({
    where: { householdId, date: { gte: from, lt: to } },
    include: {
      category: { select: { name: true } },
      instrument: { select: { name: true } },
      importBatch: { select: { fileName: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    amount: Number(t.amount),
    currency: t.currency,
    instrumentId: t.instrumentId,
    notes: t.notes,
    source: sourceOf(t),
    importBatchId: t.importBatchId,
    createdAt: t.createdAt.toISOString(),
    // for showing the match
    categoryName: t.category.name,
    instrumentName: t.instrument.name,
  }));
}

export type ExistingTxn = Awaited<ReturnType<typeof loadForDuplicateCheck>>[number];

// The most likely existing duplicate of one transaction about to be added.
export async function findExistingDuplicate(
  householdId: string,
  candidate: Omit<DupTxn, "id">
): Promise<{ match: DupMatch; existing: ExistingTxn } | null> {
  const existing = await loadForDuplicateCheck(householdId, candidate.date, candidate.date);
  const match = findDuplicate(candidate, existing);
  if (!match) return null;
  return { match, existing: existing.find((e) => e.id === match.id)! };
}

export function describeExisting(e: ExistingTxn) {
  return {
    id: e.id,
    date: e.date,
    amount: e.amount,
    currency: e.currency,
    notes: e.notes,
    categoryName: e.categoryName,
    instrumentName: e.instrumentName,
    source: e.source,
  };
}
