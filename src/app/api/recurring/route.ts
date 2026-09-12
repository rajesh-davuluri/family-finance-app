import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Currency, RecurrenceFrequency } from "@/lib/enums";

const createSchema = z.object({
  amount: z.number().positive(),
  currency: Currency,
  notes: z.string().optional(),
  frequency: RecurrenceFrequency,
  nextRunAt: z.string(), // ISO date — when the first occurrence should generate
  categoryId: z.string(),
  instrumentId: z.string(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const templates = await prisma.recurringTemplate.findMany({
    where: { householdId: user.householdId },
    include: { category: true, instrument: true },
    orderBy: { nextRunAt: "asc" },
  });
  return NextResponse.json(templates);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const template = await prisma.recurringTemplate.create({
    data: {
      amount: data.amount,
      currency: data.currency,
      notes: data.notes,
      frequency: data.frequency,
      nextRunAt: new Date(data.nextRunAt),
      categoryId: data.categoryId,
      instrumentId: data.instrumentId,
      householdId: user.householdId,
    },
  });
  return NextResponse.json(template, { status: 201 });
}
