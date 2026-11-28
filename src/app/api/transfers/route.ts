import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Currency } from "@/lib/enums";

const createSchema = z.object({
  fromInstrumentId: z.string(),
  toInstrumentId: z.string(),
  amount: z.number().positive(),
  currency: Currency,
  date: z.string(),
  notes: z.string().optional(),
  // Set after the "already recorded?" warning, to add it anyway.
  allowDuplicate: z.boolean().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const transfers = await prisma.transfer.findMany({
    where: { householdId: user.householdId },
    include: { fromInstrument: true, toInstrument: true },
    orderBy: { date: "desc" },
    take: 100,
  });
  return NextResponse.json(transfers);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  if (data.fromInstrumentId === data.toInstrumentId) {
    return NextResponse.json({ error: "Choose two different instruments." }, { status: 400 });
  }

  const [from, to] = await Promise.all([
    prisma.paymentInstrument.findUnique({ where: { id: data.fromInstrumentId } }),
    prisma.paymentInstrument.findUnique({ where: { id: data.toInstrumentId } }),
  ]);
  if (!from || from.householdId !== user.householdId || !to || to.householdId !== user.householdId) {
    return NextResponse.json({ error: "Invalid instrument." }, { status: 400 });
  }
  // One currency per transfer: money changing currency (to India) is a
  // remittance, with the rupees received and the rate.
  if (from.currency !== to.currency) {
    return NextResponse.json(
      { error: `${from.name} is in ${from.currency} and ${to.name} in ${to.currency}. Record money sent to India on Money to India, with what arrived.`, currencyMismatch: true },
      { status: 400 },
    );
  }
  // The same amount between the same two accounts on the same day: most
  // likely already recorded (Mark paid, or entered on Instruments).
  const day = new Date(`${String(data.date).slice(0, 10)}T00:00:00Z`);
  if (!data.allowDuplicate) {
    const same = await prisma.transfer.findFirst({
      where: { householdId: user.householdId, fromInstrumentId: from.id, toInstrumentId: to.id, amount: data.amount, date: { gte: day, lt: new Date(day.getTime() + 86_400_000) } },
      select: { id: true, date: true, amount: true, notes: true },
    });
    if (same) return NextResponse.json({ duplicate: { id: same.id, date: same.date.toISOString().slice(0, 10), amount: Number(same.amount), notes: same.notes } }, { status: 409 });
  }

  const transfer = await prisma.transfer.create({
    data: {
      amount: data.amount,
      currency: data.currency,
      date: new Date(data.date),
      // A card payment says so, like "Mark paid" does.
      notes: data.notes || (to.type === "CREDIT_CARD" ? `${to.name} payment` : undefined),
      fromInstrumentId: data.fromInstrumentId,
      toInstrumentId: data.toInstrumentId,
      householdId: user.householdId,
      createdById: user.id,
    },
    include: { fromInstrument: true, toInstrument: true },
  });
  return NextResponse.json(transfer, { status: 201 });
}
