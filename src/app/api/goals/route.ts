import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Currency } from "@/lib/enums";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";

const createSchema = z.object({
  name: z.string().min(1),
  targetAmount: z.number().positive(),
  currency: Currency,
  targetDate: z.string().optional(),
  instrumentId: z.string(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const goals = await prisma.savingsGoal.findMany({
    where: { householdId: user.householdId },
    include: { instrument: true },
    orderBy: { createdAt: "desc" },
  });

  const withProgress = await Promise.all(
    goals.map(async (g) => {
      const current =
        g.instrument.openingBalance !== null && g.instrument.openingBalanceDate !== null
          ? await computeInstrumentBalance(g.instrumentId, Number(g.instrument.openingBalance), g.instrument.openingBalanceDate)
          : null;
      return { ...g, currentAmount: current };
    })
  );

  return NextResponse.json(withProgress);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: data.instrumentId } });
  if (!instrument || instrument.householdId !== user.householdId) {
    return NextResponse.json({ error: "Invalid instrument." }, { status: 400 });
  }

  const goal = await prisma.savingsGoal.create({
    data: {
      name: data.name,
      targetAmount: data.targetAmount,
      currency: data.currency,
      targetDate: data.targetDate ? new Date(data.targetDate) : undefined,
      instrumentId: data.instrumentId,
      householdId: user.householdId,
    },
  });
  return NextResponse.json(goal, { status: 201 });
}
