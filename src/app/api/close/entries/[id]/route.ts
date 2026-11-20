import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Undo a close: the period opens again and any balance adjustment it
// recorded is deleted. Only an account's latest close can be undone, so the
// closed periods stay one after another.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const close = await prisma.periodClose.findUnique({ where: { id }, include: { instrument: { select: { householdId: true } } } });
  if (!close || close.instrument.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const later = await prisma.periodClose.count({ where: { instrumentId: close.instrumentId, periodEnd: { gt: close.periodEnd } } });
  if (later) return NextResponse.json({ error: "Undo the later close first." }, { status: 400 });

  const adjustment = close.adjustmentTransactionId
    ? await prisma.transaction.findFirst({ where: { id: close.adjustmentTransactionId, householdId: user.householdId } })
    : null;
  await prisma.$transaction([
    ...(adjustment ? [prisma.transaction.delete({ where: { id: adjustment.id } })] : []),
    prisma.periodClose.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
