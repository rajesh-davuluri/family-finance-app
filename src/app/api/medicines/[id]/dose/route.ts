import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { ownedMedicine, toDate } from "@/lib/medicineData";
import { doseFields, drawDose, qty } from "@/lib/medicines";

// Record a dose taken: it comes out of the pack that expires first.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const medicine = await ownedMedicine(id, user.householdId);
  if (!medicine) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = doseFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter how much was taken, above 0." }, { status: 400 });
  const f = parsed.data;
  const today = calendarDateInZone();
  const takenOn = f.takenOn ?? today;

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.medicineStock.findMany({ where: { medicineId: id, discardedOn: null, remaining: { gt: 0 } } });
    const packs = rows.map((s) => ({
      id: s.id,
      quantity: Number(s.quantity),
      remaining: Number(s.remaining),
      expiresOn: s.expiresOn ? s.expiresOn.toISOString().slice(0, 10) : null,
      addedOn: s.addedOn.toISOString().slice(0, 10),
      discardedOn: null,
      note: s.note,
    }));
    // A dose recorded for an earlier day can come out of a pack that was
    // still in date then.
    const { draws, short } = drawDose(packs, f.quantity, takenOn < today ? takenOn : today);
    for (const d of draws) {
      await tx.medicineStock.update({ where: { id: d.stockId }, data: { remaining: { decrement: d.quantity } } });
    }
    const dose = await tx.medicineDose.create({
      data: { medicineId: id, takenOn: toDate(takenOn), quantity: f.quantity, draws: JSON.stringify(draws), byUserId: user.id, note: f.note },
    });
    return { id: dose.id, short };
  });
  return NextResponse.json(
    { id: result.id, warning: result.short > 0 ? `Recorded, but only ${qty(f.quantity - result.short, medicine.unit)} were in stock. Add the pack it came from.` : null },
    { status: 201 }
  );
}
