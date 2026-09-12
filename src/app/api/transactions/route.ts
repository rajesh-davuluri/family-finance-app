import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Currency } from "@/lib/enums";

const createSchema = z.object({
  amount: z.number().positive(),
  currency: Currency,
  date: z.string(), // ISO date string from a <input type="date">
  notes: z.string().optional(),
  categoryId: z.string(),
  instrumentId: z.string(),
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
    include: { category: true, instrument: true, createdBy: { select: { name: true } } },
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

  const transaction = await prisma.transaction.create({
    data: {
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
  return NextResponse.json(transaction, { status: 201 });
}
