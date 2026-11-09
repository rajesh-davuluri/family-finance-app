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
      category: { select: { name: true, direction: true } },
      instrument: { select: { name: true } },
      importBatch: { select: { fileName: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const flat = rows.map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    amount: Number(t.amount),
    currency: t.currency,
    instrumentId: t.instrumentId,
    notes: t.notes,
    source: sourceOf(t),
    importBatchId: t.importBatchId,
    moneyIn: t.category.direction === "INCOME",
    createdAt: t.createdAt.toISOString(),
    // for showing the match
    categoryName: t.category.name,
    instrumentName: t.instrument.name,
    splitGroupId: t.splitGroupId,
  }));
  return mergeSplits(flat);
}

// The parts of a bill split across categories are one charge: a card
// statement line of $73.26 matches Groceries $43.77 + Clothing $13.01 +
// Home $16.48 together, and the parts never look like copies of each other.
function mergeSplits<T extends { id: string; amount: number; categoryName: string; splitGroupId: string | null }>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  const out: T[] = [];
  for (const r of rows) {
    if (!r.splitGroupId) {
      out.push(r);
      continue;
    }
    const g = groups.get(r.splitGroupId);
    if (g) g.push(r);
    else {
      const parts = [r];
      groups.set(r.splitGroupId, parts);
      out.push(r); // placeholder, replaced below (keeps createdAt order)
    }
  }
  return out.map((r) => {
    const parts = r.splitGroupId ? groups.get(r.splitGroupId) : null;
    if (!parts || parts.length < 2) return r;
    return {
      ...r,
      amount: Math.round(parts.reduce((t, p) => t + p.amount, 0) * 100) / 100,
      categoryName: `Split: ${parts.map((p) => p.categoryName).join(" + ")}`,
    };
  });
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
