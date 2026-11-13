import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";
import { calendarDateInZone } from "@/lib/appTimezone";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { CycleTransaction, Payday, addDays, biweeklyPaydays, buildCycles, expectedPaydays, isSalary } from "@/lib/payCycles";
import { countsAsSpending, kindOf } from "@/lib/categoryKind";
import { detectHouseholdRecurring } from "@/lib/recurringData";
import { dueBefore } from "@/lib/recurringDetect";
import { PaycheckDetailView, detailData, hasDetail, paycheckDetailSchema } from "@/lib/paycheckDetail";

// Data for the Paychecks page: the biweekly paydays (from actual Salary
// transactions), every transaction since the first of them, bills due before
// the next paycheck, and bank balances where an opening balance makes them
// knowable. The cycle math itself lives in src/lib/payCycles.ts and runs on
// the page, so switching cycles needs no extra request.

const MAX_TRANSACTIONS = 5000;
const usd2 = (amount: number, currency: string) => Math.round(toApproxUsd(amount, currency) * 100) / 100;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const householdId = user.householdId;
  const today = calendarDateInZone();

  const [incomeRows, bankRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId, category: { direction: "INCOME" } },
      select: {
        id: true,
        date: true,
        amount: true,
        currency: true,
        instrumentId: true,
        category: { select: { name: true, direction: true, kind: true } },
        paycheck: { select: { hoursPaid: true, periodStart: true, periodEnd: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.paymentInstrument.findMany({ where: { householdId, type: "BANK_ACCOUNT", archived: false }, orderBy: { name: "asc" } }),
  ]);
  // Bank accounts a paycheck can be added to, the usual one first.
  const salaries: Payday[] = incomeRows
    .filter((t) => isSalary(kindOf(t.category), t.category.name))
    .map((t) => ({
      date: t.date.toISOString().slice(0, 10),
      amount: Number(t.amount),
      currency: t.currency,
      usd: usd2(Number(t.amount), t.currency),
      transactionId: t.id,
    }));

  const lastInstrument = [...incomeRows].reverse().find((t) => isSalary(kindOf(t.category), t.category.name))?.instrumentId ?? null;
  const banks = bankRows
    .map((b) => ({ id: b.id, name: b.name, currency: b.currency }))
    .sort((a, b) => Number(b.id === lastInstrument) - Number(a.id === lastInstrument));
  // Hours and pay period, by Salary transaction.
  const details: Record<string, PaycheckDetailView> = {};
  for (const t of incomeRows) {
    if (!t.paycheck) continue;
    details[t.id] = {
      hoursPaid: t.paycheck.hoursPaid == null ? null : Number(t.paycheck.hoursPaid),
      periodStart: t.paycheck.periodStart?.toISOString().slice(0, 10) ?? null,
      periodEnd: t.paycheck.periodEnd?.toISOString().slice(0, 10) ?? null,
    };
  }

  if (salaries.length === 0) return NextResponse.json({ hasData: false, today, banks, details });

  const { paydays, earlierIgnored } = biweeklyPaydays(salaries);
  const cycles = buildCycles(paydays);
  const first = cycles[0].start;
  const last = cycles[cycles.length - 1];
  const until = last.end > today ? last.end : today;

  const rows = await prisma.transaction.findMany({
    where: {
      householdId,
      date: { gte: new Date(`${first}T00:00:00Z`), lt: new Date(`${addDays(until, 1)}T00:00:00Z`) },
    },
    include: { category: { select: { name: true, direction: true, kind: true } }, instrument: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: MAX_TRANSACTIONS + 1,
  });
  const transactions: CycleTransaction[] = rows.slice(0, MAX_TRANSACTIONS).map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    amount: Number(t.amount),
    currency: t.currency,
    usd: usd2(Number(t.amount), t.currency),
    notes: t.notes,
    categoryId: t.categoryId,
    categoryName: t.category.name,
    direction: t.category.direction === "INCOME" ? "INCOME" : "EXPENSE",
    kind: kindOf(t.category),
    instrumentName: t.instrument.name,
  }));

  // Recurring bills that will post after today and before the next paycheck.
  const nextPayday = last.nextPayday > today ? last.nextPayday : addDays(today, 1);
  const templates = await prisma.recurringTemplate.findMany({
    where: {
      householdId,
      active: true,
      nextRunAt: { gt: new Date(`${today}T00:00:00Z`), lt: new Date(`${nextPayday}T00:00:00Z`) },
      category: { direction: "EXPENSE" },
    },
    include: { category: { select: { name: true, direction: true, kind: true } }, instrument: { select: { name: true } } },
    orderBy: { nextRunAt: "asc" },
  });
  // Only bills that are really spending -- not a scheduled savings transfer.
  const upcomingBills = templates.filter((t) => countsAsSpending(kindOf(t.category))).map((t) => ({
    id: t.id,
    date: t.nextRunAt.toISOString().slice(0, 10),
    label: t.notes || t.category.name,
    categoryName: t.category.name,
    instrumentName: t.instrument.name,
    amount: Number(t.amount),
    currency: t.currency,
    usd: usd2(Number(t.amount), t.currency),
  }));

  // Bills found in history (rent, loan EMIs, insurance...) expected before the
  // next paycheck, and the set-aside they add up to per paycheck. Skips any
  // already covered by a recurring template in the same category.
  const { bills } = await detectHouseholdRecurring(householdId, today);
  const templateCategories = new Set(upcomingBills.map((b) => b.categoryName));
  const expectedBills = dueBefore(bills, today, nextPayday)
    .filter((b) => b.kind !== "SAVINGS" && !templateCategories.has(b.categoryName))
    .map((b) => ({
      key: b.key,
      date: b.nextDate,
      label: b.label,
      categoryName: b.categoryName,
      instrumentName: b.instrumentName,
      amount: b.amount,
      currency: b.currency,
      usd: b.usd,
      frequency: b.frequency,
    }));
  const setAsidePerPaycheckUsd =
    Math.round(bills.filter((b) => b.status !== "STOPPED").reduce((s, b) => s + b.perPaycheckUsd, 0) * 100) / 100;

  // Bank balances, only where an opening balance makes them knowable.
  const bankBalances = await Promise.all(
    bankRows.map(async (b) => {
      const known = b.openingBalance !== null && b.openingBalanceDate !== null;
      const balance = known ? await computeInstrumentBalance(b.id, Number(b.openingBalance), b.openingBalanceDate!) : null;
      return { id: b.id, name: b.name, currency: b.currency, balance, usd: balance === null ? null : usd2(balance, b.currency) };
    })
  );

  return NextResponse.json({
    hasData: true,
    today,
    cycles,
    expected: expectedPaydays(last.start, 5),
    earlierSalaryDays: earlierIgnored,
    transactions,
    truncated: rows.length > MAX_TRANSACTIONS,
    upcomingBills,
    expectedBills,
    setAsidePerPaycheckUsd,
    bankBalances,
    banks,
    details,
  });
}

// Add a paycheck: a Salary transaction on the day it landed, with the hours
// paid and the pay period.
const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive().max(10_000_000),
  instrumentId: z.string().min(1),
  notes: z.string().max(500).optional(),
  detail: paycheckDetailSchema,
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.path[0] === "detail" ? issue.message : "Check the amount, date and account." }, { status: 400 });
  }
  const { date, amount, instrumentId, notes, detail } = parsed.data;
  const householdId = user.householdId;

  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument || instrument.householdId !== householdId || instrument.archived) return NextResponse.json({ error: "Pick one of your accounts." }, { status: 400 });

  // The Salary category last used, else one named for pay, else a new one.
  const incomeCats = await prisma.transactionCategory.findMany({ where: { householdId, direction: "INCOME" } });
  const salaryCats = incomeCats.filter((c) => isSalary(kindOf(c), c.name));
  const lastUsed = salaryCats.length
    ? await prisma.transaction.findFirst({ where: { householdId, categoryId: { in: salaryCats.map((c) => c.id) } }, orderBy: { date: "desc" }, select: { categoryId: true } })
    : null;
  const categoryId =
    lastUsed?.categoryId ??
    salaryCats[0]?.id ??
    (await prisma.transactionCategory.create({ data: { name: "Salary", direction: "INCOME", kind: "INCOME", group: "INCOME", householdId } })).id;

  const created = await prisma.transaction.create({
    data: {
      source: "MANUAL",
      amount,
      currency: instrument.currency,
      date: new Date(`${date}T00:00:00Z`),
      notes: notes || "Paycheck",
      categoryId,
      instrumentId,
      householdId,
      createdById: user.id,
      ...(hasDetail(detail) ? { paycheck: { create: detailData(detail) } } : {}),
    },
    select: { id: true },
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
