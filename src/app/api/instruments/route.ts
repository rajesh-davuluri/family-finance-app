import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { InstrumentType, Currency } from "@/lib/enums";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";

const createSchema = z.object({
  name: z.string().min(1),
  type: InstrumentType,
  last4: z.string().max(4).optional(),
  currency: Currency,
  openingBalance: z.number().optional(),
  openingBalanceDate: z.string().optional(), // required together with openingBalance -- validated below
  creditLimit: z.number().positive().optional(), // credit cards only
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const instruments = await prisma.paymentInstrument.findMany({
    where: { householdId: user.householdId },
    orderBy: [{ archived: "asc" }, { name: "asc" }],
  });

  // Current balance is never stored -- compute it fresh from opening
  // balance + transactions since that date, same principle as debt
  // balances and recurring-template math elsewhere in the app.
  //
  // Credit cards without an opening balance fall back to the sum of every
  // transaction and transfer on the card (i.e. assuming it started at zero),
  // flagged as balanceFromTransactionsOnly so the UI can say it may be
  // missing activity from before the app's records begin. Other instrument
  // types have no such fallback -- a bank account's starting money can't be
  // guessed.
  const withBalance = await Promise.all(
    instruments.map(async (i) => {
      const hasOpening = i.openingBalance !== null && i.openingBalanceDate !== null;
      const fallback = !hasOpening && i.type === "CREDIT_CARD";
      return {
        ...i,
        currentBalance: hasOpening
          ? await computeInstrumentBalance(i.id, Number(i.openingBalance), i.openingBalanceDate!)
          : fallback
            ? await computeInstrumentBalance(i.id, 0, new Date(0))
            : null,
        balanceFromTransactionsOnly: fallback,
      };
    })
  );

  return NextResponse.json(withBalance);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  if ((data.openingBalance !== undefined) !== (data.openingBalanceDate !== undefined)) {
    return NextResponse.json({ error: "openingBalance and openingBalanceDate must be set together." }, { status: 400 });
  }

  const instrument = await prisma.paymentInstrument.create({
    data: {
      name: data.name,
      type: data.type,
      last4: data.last4,
      currency: data.currency,
      householdId: user.householdId,
      openingBalance: data.openingBalance,
      openingBalanceDate: data.openingBalanceDate ? new Date(data.openingBalanceDate) : undefined,
      creditLimit: data.type === "CREDIT_CARD" ? data.creditLimit : undefined,
    },
  });
  return NextResponse.json(instrument, { status: 201 });
}
