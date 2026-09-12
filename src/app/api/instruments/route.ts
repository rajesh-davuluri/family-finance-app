import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { InstrumentType, Currency } from "@/lib/enums";

const createSchema = z.object({
  name: z.string().min(1),
  type: InstrumentType,
  last4: z.string().max(4).optional(),
  currency: Currency,
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const instruments = await prisma.paymentInstrument.findMany({
    where: { householdId: user.householdId },
    orderBy: [{ archived: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(instruments);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const instrument = await prisma.paymentInstrument.create({
    data: { ...parsed.data, householdId: user.householdId },
  });
  return NextResponse.json(instrument, { status: 201 });
}
