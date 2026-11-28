import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { parseDraws } from "@/lib/medicines";

// Undo a dose recorded by mistake: what it took goes back into its packs.
export async function DELETE(_req: Request, { params }: { params: Promise<{ doseId: string }> }) {
  const { doseId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const dose = await prisma.medicineDose.findUnique({ where: { id: doseId }, include: { medicine: { select: { householdId: true } } } });
  if (!dose || dose.medicine.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    for (const d of parseDraws(dose.draws)) {
      // A pack thrown away since stays thrown away; a deleted one is gone.
      await tx.medicineStock.updateMany({ where: { id: d.stockId, medicineId: dose.medicineId, discardedOn: null }, data: { remaining: { increment: d.quantity } } });
    }
    await tx.medicineDose.delete({ where: { id: doseId } });
  });
  return NextResponse.json({ ok: true });
}
