import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { DebtStatus } from "@/lib/enums";
import { computeBalance } from "@/lib/debtCalculations";
import { deleteDebtCascade } from "@/lib/cascadeDelete";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  interestRate: z.number().min(0).max(100).nullable().optional(),
  conversionRateToUsd: z.number().positive().nullable().optional(),
  installmentAmount: z.number().positive().nullable().optional(),
  installmentFrequency: z.string().nullable().optional(),
  status: DebtStatus.optional(),
  notes: z.string().optional(),
});

async function getOwnedDebt(id: string, householdId: string) {
  const debt = await prisma.debt.findUnique({
    where: { id },
    include: { payments: { orderBy: { paymentDate: "desc" } }, owner: { select: { id: true, name: true } } },
  });
  if (!debt || debt.householdId !== householdId) return null;
  return debt;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const debt = await getOwnedDebt(id, user.householdId);
  if (!debt) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const balance = computeBalance(Number(debt.originalPrincipal), debt.payments.map((p) => ({ amount: Number(p.amount) })));
  return NextResponse.json({ ...debt, balance });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const existing = await getOwnedDebt(id, user.householdId);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await prisma.debt.update({ where: { id }, data: parsed.data });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const existing = await getOwnedDebt(id, user.householdId);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await deleteDebtCascade(id);
  return NextResponse.json({ ok: true });
}
