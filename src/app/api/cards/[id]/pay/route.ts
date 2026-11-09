import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";

// "Mark as paid": records a card payment as a transfer from a bank account
// to the card, so the card's statement shows paid and the bank balance goes
// down. When the bank statement is imported later, the import recognises
// the same payment (same amount, within a few days) and doesn't add it twice.

const schema = z.object({
  fromInstrumentId: z.string().min(1),
  amount: z.number().positive().max(10_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the amount and date." }, { status: 400 });
  const { fromInstrumentId, amount, date } = parsed.data;

  const [card, from] = await Promise.all([
    prisma.paymentInstrument.findUnique({ where: { id } }),
    prisma.paymentInstrument.findUnique({ where: { id: fromInstrumentId } }),
  ]);
  if (!card || card.householdId !== user.householdId || card.type !== "CREDIT_CARD") {
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  }
  if (!from || from.householdId !== user.householdId || from.archived || from.type === "CREDIT_CARD") {
    return NextResponse.json({ error: "Choose the bank account you paid from." }, { status: 400 });
  }
  if (from.currency !== card.currency) {
    return NextResponse.json({ error: `${from.name} is in ${from.currency}; this card is in ${card.currency}.` }, { status: 400 });
  }

  // A phone ahead of the household's time zone (travelling, or late evening
  // in India) may say tomorrow; a payment can't be dated after today here.
  const today = calendarDateInZone();
  const paidOn = date > today ? today : date;

  const transfer = await prisma.transfer.create({
    data: {
      amount: Math.round(amount * 100) / 100,
      currency: card.currency,
      date: new Date(`${paidOn}T00:00:00Z`),
      notes: `${card.name} payment (marked paid in the app)`,
      fromInstrumentId: from.id,
      toInstrumentId: card.id,
      householdId: user.householdId,
      createdById: user.id,
    },
  });
  return NextResponse.json({ id: transfer.id }, { status: 201 });
}
