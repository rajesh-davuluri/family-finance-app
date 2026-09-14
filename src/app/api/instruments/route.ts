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
  const withBalance = await Promise.all(
    instruments.map(async (i) => ({
      ...i,
      currentBalance:
        i.openingBalance !== null && i.openingBalanceDate !== null
          ? await computeInstrumentBalance(i.id, Number(i.openingBalance), i.openingBalanceDate)
          : null,
    }))
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
    },
  });
  return NextResponse.json(instrument, { status: 201 });
}
