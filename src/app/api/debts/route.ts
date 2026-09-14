import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { DebtCategory, InstallmentFrequency, Currency } from "@/lib/enums";
import { computeBalance } from "@/lib/debtCalculations";

const createSchema = z.object({
  name: z.string().min(1),
  category: DebtCategory,
  currency: Currency,
  conversionRateToUsd: z.number().positive().optional(), // only meaningful when currency != USD
  originalPrincipal: z.number().positive(),
  interestRate: z.number().min(0).max(100).optional(),
  startDate: z.string(),
  installmentAmount: z.number().positive().optional(),
  installmentFrequency: InstallmentFrequency.optional(),
  ownerId: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const debts = await prisma.debt.findMany({
    where: { householdId: user.householdId },
    include: { payments: true, owner: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const withBalance = debts.map((d) => ({
    ...d,
    balance: computeBalance(Number(d.originalPrincipal), d.payments.map((p) => ({ amount: Number(p.amount) }))),
    totalPaid: d.payments.reduce((sum, p) => sum + Number(p.amount), 0),
  }));

  return NextResponse.json(withBalance);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  if (data.ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: data.ownerId } });
    if (!owner || owner.householdId !== user.householdId) {
      return NextResponse.json({ error: "Invalid owner." }, { status: 400 });
    }
  }

  const debt = await prisma.debt.create({
    data: {
      name: data.name,
      category: data.category,
      currency: data.currency,
      conversionRateToUsd: data.currency === "USD" ? undefined : data.conversionRateToUsd,
      originalPrincipal: data.originalPrincipal,
      interestRate: data.interestRate,
      startDate: new Date(data.startDate),
      installmentAmount: data.installmentAmount,
      installmentFrequency: data.installmentFrequency,
      notes: data.notes,
      ownerId: data.ownerId,
      householdId: user.householdId,
    },
  });
  return NextResponse.json(debt, { status: 201 });
}
