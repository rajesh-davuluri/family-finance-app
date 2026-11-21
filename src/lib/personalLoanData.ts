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

// What a loan entry is, from the household's side. The way money moves
// follows from it: lending and paying back go out; borrowing and being paid
// back come in.
export const LOAN_TYPES = ["LENT", "BORROWED", "REPAID_TO_YOU", "YOU_REPAID"] as const;
export type LoanType = (typeof LOAN_TYPES)[number];
export const wayOf = (t: LoanType): "IN" | "OUT" => (t === "BORROWED" || t === "REPAID_TO_YOU" ? "IN" : "OUT");
const NOTE: Record<LoanType, (name: string) => string> = {
  LENT: (n) => `Lent to ${n}`,
  BORROWED: (n) => `Borrowed from ${n}`,
  REPAID_TO_YOU: (n) => `Paid back by ${n}`,
  YOU_REPAID: (n) => `Paid back to ${n}`,
};

// Money with a person, saved as a transaction on the account in a loan
// category (neither income nor spending), linked to the person -- what both
// Lent & borrowed and Add Transaction record.
export async function recordLoanMoney(input: {
  householdId: string;
  userId: string;
  personId: string;
  personName: string;
  way: "IN" | "OUT";
  type?: LoanType;
  amount: number;
  instrumentId: string;
  date: string; // YYYY-MM-DD
  notes?: string;
}): Promise<{ id: string } | { error: string }> {
  const inst = await prisma.paymentInstrument.findUnique({ where: { id: input.instrumentId } });
  if (!inst || inst.householdId !== input.householdId) return { error: "Choose an account." };
  const categoryId = await loanCategoryId(input.householdId, input.way === "IN" ? "INCOME" : "EXPENSE");
  const fallback = input.type ? NOTE[input.type](input.personName) : input.way === "IN" ? `From ${input.personName}` : `To ${input.personName}`;
  const txn = await prisma.transaction.create({
    data: {
      amount: input.amount,
      currency: inst.currency,
      date: new Date(`${input.date}T00:00:00Z`),
      notes: input.notes || fallback,
      householdId: input.householdId,
      categoryId,
      instrumentId: inst.id,
      createdById: input.userId,
      source: "MANUAL",
      loanContactId: input.personId,
    },
  });
  return { id: txn.id };
}

// The person with this name (any letter case), added if they're new.
export async function findOrAddPerson(householdId: string, name: string, phone?: string | null) {
  const clean = name.trim().replace(/\s+/g, " ");
  const all = await prisma.loanContact.findMany({ where: { householdId }, select: { id: true, name: true } });
  const found = all.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (found) return { ...found, created: false };
  const p = await prisma.loanContact.create({ data: { householdId, name: clean, phone: phone || null } });
  return { id: p.id, name: p.name, created: true };
}
