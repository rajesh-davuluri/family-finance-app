import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Currency } from "@/lib/enums";
import { computeBalance } from "@/lib/debtCalculations";

const createSchema = z.object({
  amount: z.number().positive(),
  currency: Currency,
  paymentDate: z.string(),
  note: z.string().optional(),
});

async function assertOwnership(debtId: string, householdId: string) {
  const debt = await prisma.debt.findUnique({ where: { id: debtId } });
  if (!debt || debt.householdId !== householdId) return null;
  return debt;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const debt = await assertOwnership(id, user.householdId);
  if (!debt) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const payments = await prisma.debtPayment.findMany({ where: { debtId: id }, orderBy: { paymentDate: "desc" } });
  return NextResponse.json(payments);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const debt = await assertOwnership(id, user.householdId);
  if (!debt) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const payment = await prisma.debtPayment.create({
    data: {
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      paymentDate: new Date(parsed.data.paymentDate),
      note: parsed.data.note,
      debtId: id,
    },
  });

  // Auto-mark as paid off once payments (converted into the debt's own
  // currency, since they may be mixed USD/INR/etc.) reach or exceed the
  // principal -- saves a manual status update for the common case.
  const allPayments = await prisma.debtPayment.findMany({ where: { debtId: id } });
  const debtInfo = { currency: debt.currency, conversionRateToUsd: debt.conversionRateToUsd ? Number(debt.conversionRateToUsd) : null };
  const balance = computeBalance(
    Number(debt.originalPrincipal),
    allPayments.map((p) => ({ amount: Number(p.amount), currency: p.currency })),
    debtInfo
  );
  if (balance <= 0 && debt.status === "ACTIVE") {
    await prisma.debt.update({ where: { id }, data: { status: "PAID_OFF" } });
  }

  return NextResponse.json(payment, { status: 201 });
}
