import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { computeBalance } from "@/lib/debtCalculations";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const debt = await prisma.debt.findUnique({ where: { id } });
  if (!debt || debt.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const payment = await prisma.debtPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.debtId !== id) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.debtPayment.delete({ where: { id: paymentId } });

  // If deleting this payment drops the balance back above zero, a
  // previously auto-marked "paid off" debt should go back to active.
  // Payments may be mixed USD/INR/etc., so this converts each into the
  // debt's own currency before comparing, same as everywhere else.
  if (debt.status === "PAID_OFF") {
    const remaining = await prisma.debtPayment.findMany({ where: { debtId: id } });
    const debtInfo = { currency: debt.currency, conversionRateToUsd: debt.conversionRateToUsd ? Number(debt.conversionRateToUsd) : null };
    const balance = computeBalance(
      Number(debt.originalPrincipal),
      remaining.map((p) => ({ amount: Number(p.amount), currency: p.currency })),
      debtInfo
    );
    if (balance > 0) {
      await prisma.debt.update({ where: { id }, data: { status: "ACTIVE" } });
    }
  }

  return NextResponse.json({ ok: true });
}
