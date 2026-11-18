import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Currency } from "@/lib/enums";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const transfer = await prisma.transfer.findUnique({ where: { id } });
  if (!transfer || transfer.householdId !== user.householdId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await prisma.transfer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// Edit a transfer: the accounts, amount, date or note. Balances are worked out
// from the transfers themselves, so both old and new accounts follow at once.
const editSchema = z.object({
  fromInstrumentId: z.string().min(1),
  toInstrumentId: z.string().min(1),
  amount: z.number().positive(),
  currency: Currency,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const transfer = await prisma.transfer.findUnique({ where: { id } });
  if (!transfer || transfer.householdId !== user.householdId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick both accounts and enter the amount and date." }, { status: 400 });
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

  const updated = await prisma.transfer.update({
    where: { id },
    data: {
      fromInstrumentId: data.fromInstrumentId,
      toInstrumentId: data.toInstrumentId,
      amount: data.amount,
      currency: data.currency,
      date: new Date(`${data.date}T00:00:00Z`),
      notes: data.notes?.trim() ? data.notes.trim() : null,
    },
    include: { fromInstrument: true, toInstrument: true },
  });
  return NextResponse.json(updated);
}
