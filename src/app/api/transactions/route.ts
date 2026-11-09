import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { describeExisting, findExistingDuplicate, rememberNotDuplicates } from "@/lib/duplicateData";
import { Currency } from "@/lib/enums";
import { notifyHousehold } from "@/lib/notify";

const createSchema = z.object({
  amount: z.number().positive(),
  currency: Currency,
  date: z.string(), // ISO date string from a <input type="date">
  notes: z.string().optional(),
  categoryId: z.string(),
  instrumentId: z.string(),
  // Set after the person has seen the duplicate warning and chosen to add it anyway.
  allowDuplicate: z.boolean().optional(),
  // Added anyway after the duplicate warning: remember that pair is fine.
  notDuplicateOf: z.string().max(64).optional(),
});

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const categoryId = searchParams.get("categoryId");
  const instrumentId = searchParams.get("instrumentId");
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);

  const transactions = await prisma.transaction.findMany({
    where: {
      householdId: user.householdId,
      ...(from || to
        ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(instrumentId ? { instrumentId } : {}),
    },
    include: {
      category: true,
      instrument: true,
      createdBy: { select: { name: true } },
      importBatch: { select: { fileName: true } },
      attachment: { select: { id: true } },
    },
    orderBy: { date: "desc" },
    take: limit,
  });
  return NextResponse.json(transactions);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  // Confirm the category and instrument actually belong to this household —
  // otherwise someone could reference another household's IDs directly.
  const [category, instrument] = await Promise.all([
    prisma.transactionCategory.findUnique({ where: { id: data.categoryId } }),
    prisma.paymentInstrument.findUnique({ where: { id: data.instrumentId } }),
  ]);
  if (!category || category.householdId !== user.householdId) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }
  if (!instrument || instrument.householdId !== user.householdId) {
    return NextResponse.json({ error: "Invalid payment instrument." }, { status: 400 });
  }

  // Likely already recorded (e.g. imported from the statement, or sent from
  // Telegram)? Ask first instead of adding a second copy.
  if (!data.allowDuplicate) {
    const dup = await findExistingDuplicate(user.householdId, {
      date: data.date.slice(0, 10),
      amount: data.amount,
      currency: data.currency,
      instrumentId: data.instrumentId,
      notes: data.notes ?? null,
      source: "MANUAL",
    });
    if (dup && dup.match.confidence === "HIGH") {
      return NextResponse.json(
        { error: "This looks like it's already recorded.", duplicate: { ...describeExisting(dup.existing), reason: dup.match.reason } },
        { status: 409 }
      );
    }
  }

  const transaction = await prisma.transaction.create({
    data: {
      source: "MANUAL",
      amount: data.amount,
      currency: data.currency,
      date: new Date(data.date),
      notes: data.notes,
      categoryId: data.categoryId,
      instrumentId: data.instrumentId,
      householdId: user.householdId,
      createdById: user.id,
    },
    include: { category: true, instrument: true },
  });

  if (data.notDuplicateOf) await rememberNotDuplicates(user.householdId, [[transaction.id, data.notDuplicateOf]]);

  const verb = category.direction === "INCOME" ? "income" : "an expense";
  await notifyHousehold(
    user.householdId,
    user.id,
    `${user.name} added ${verb}: ${data.currency} ${data.amount.toFixed(2)} (${category.name}) on ${instrument.name}`
  );

  return NextResponse.json(transaction, { status: 201 });
}
