import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toApproxUsd } from "@/lib/fx";
import { countsAsSpending, kindOf } from "@/lib/categoryKind";
import { inferGroup } from "@/lib/categoryGroups";
import { LOAN_NOTE, personBalance, suggestPerson, type LoanEntry } from "@/lib/personalLoans";

// Lent & borrowed, server side: each person's balance and history, the
// transactions that look like money between people but aren't linked to
// anyone yet, and the totals that go into net worth.

const day = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const UNLINKED_DAYS = 365;

type TxnRow = {
  id: string;
  date: Date;
  amount: unknown;
  currency: string;
  notes: string | null;
  category: { name: string; direction: string; kind: string | null };
  instrument: { name: string };
};

// Money out adds to what they owe you; money in takes it off.
export function toEntry(t: TxnRow): LoanEntry {
  const usd = r2(toApproxUsd(Number(t.amount), t.currency));
  const kind = kindOf(t.category);
  return {
    id: t.id,
    date: day(t.date),
    amountUsd: t.category.direction === "INCOME" ? -usd : usd,
    label: t.category.name,
    notes: t.notes,
    account: t.instrument.name,
    countsAsSpending: countsAsSpending(kind) || kind === "INCOME",
  };
}

const txnSelect = {
  id: true,
  date: true,
  amount: true,
  currency: true,
  notes: true,
  category: { select: { name: true, direction: true, kind: true } },
  instrument: { select: { name: true } },
} as const;

export type Person = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  openingUsd: number;
  openingDate: string | null;
  balanceUsd: number;
  since: string | null;
  lentUsd: number;
  receivedUsd: number;
  lastDate: string | null;
  entries: LoanEntry[]; // newest first
};

export async function loadPeople(householdId: string): Promise<Person[]> {
  const contacts = await prisma.loanContact.findMany({
    where: { householdId },
    include: { transactions: { select: txnSelect } },
    orderBy: { name: "asc" },
  });
  return contacts.map((c) => {
    const entries = c.transactions.map(toEntry);
    const opening = { amountUsd: Number(c.openingBalance), date: c.openingDate ? day(c.openingDate) : day(c.createdAt) };
    const b = personBalance(opening, entries);
    const sorted = [...entries].sort((a, z) => z.date.localeCompare(a.date));
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      notes: c.notes,
      openingUsd: opening.amountUsd,
      openingDate: c.openingDate ? day(c.openingDate) : null,
      ...b,
      lastDate: sorted[0]?.date ?? null,
      entries: sorted.slice(0, 60),
    };
  });
}

// What's owed to the household and by it, for net worth.
export async function loanPosition(householdId: string): Promise<{ owedToYouUsd: number; youOweUsd: number }> {
  const people = await loadPeople(householdId);
  return {
    owedToYouUsd: r2(people.filter((p) => p.balanceUsd > 0).reduce((s, p) => s + p.balanceUsd, 0)),
    youOweUsd: r2(-people.filter((p) => p.balanceUsd < 0).reduce((s, p) => s + p.balanceUsd, 0)),
  };
}

export type Unlinked = LoanEntry & { suggestion: { name: string; existing: boolean } | null; reason: "LOAN_CATEGORY" | "NOTE" };

// Transactions in a loan category, or whose note reads like money between
// people, not linked to anyone yet: the last year, newest first.
export async function loadUnlinked(householdId: string, today: string, names: string[]): Promise<Unlinked[]> {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - UNLINKED_DAYS * 86_400_000);
  const rows = await prisma.transaction.findMany({
    where: { householdId, loanContactId: null, date: { gte: since } },
    select: txnSelect,
    orderBy: { date: "desc" },
    take: 3000,
  });
  const out: Unlinked[] = [];
  for (const t of rows) {
    const isLoan = kindOf(t.category) === "LOAN";
    const byNote = !isLoan && LOAN_NOTE.test(t.notes ?? "");
    if (!isLoan && !byNote) continue;
    out.push({ ...toEntry(t), suggestion: suggestPerson(t.notes, names), reason: isLoan ? "LOAN_CATEGORY" : "NOTE" });
    if (out.length >= 60) break;
  }
  return out;
}

// The category a repayment is recorded in: an existing loan category going
// the right way (one named for lending or loans first), or a new one.
export async function loanCategoryId(householdId: string, direction: "INCOME" | "EXPENSE"): Promise<string> {
  const cats = await prisma.transactionCategory.findMany({ where: { householdId, direction } });
  const loans = cats.filter((c) => kindOf(c) === "LOAN");
  const pick = loans.find((c) => /lent|lend|hand\s*loan|personal\s*loan|loan/i.test(c.name)) ?? loans[0];
  if (pick) return pick.id;
  const name = direction === "INCOME" ? "Personal loans (in)" : "Personal loans (out)";
  const existing = cats.find((c) => c.name === name);
  if (existing) return existing.id;
  const created = await prisma.transactionCategory.create({ data: { householdId, name, direction, kind: "LOAN", group: inferGroup(name, "LOAN") } });
  return created.id;
}

// The fields a person form sends.
export const personFields = z.object({
  name: z.string().trim().min(1).max(200),
  // Owed before the app's records, approx USD: positive = they owe you.
  openingBalance: z.number().min(-10_000_000).max(10_000_000).optional(),
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
