import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const debt = await prisma.debt.findUnique({ where: { id } });
  if (!debt || debt.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const payment = await prisma.debtPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.debtId !== id) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.debtPayment.delete({ where: { id: paymentId } });

  // If deleting this payment drops the total below the principal, a
  // previously auto-marked "paid off" debt should go back to active.
  if (debt.status === "PAID_OFF") {
    const remaining = await prisma.debtPayment.findMany({ where: { debtId: id } });
    const totalPaid = remaining.reduce((sum, p) => sum + Number(p.amount), 0);
    if (totalPaid < Number(debt.originalPrincipal)) {
      await prisma.debt.update({ where: { id }, data: { status: "ACTIVE" } });
    }
  }

  return NextResponse.json({ ok: true });
}
