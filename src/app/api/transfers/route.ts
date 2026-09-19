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

  const transfer = await prisma.transfer.create({
    data: {
      amount: data.amount,
      currency: data.currency,
      date: new Date(data.date),
      notes: data.notes,
      fromInstrumentId: data.fromInstrumentId,
      toInstrumentId: data.toInstrumentId,
      householdId: user.householdId,
      createdById: user.id,
    },
    include: { fromInstrument: true, toInstrument: true },
  });
  return NextResponse.json(transfer, { status: 201 });
}
