import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { ownedMedicine } from "@/lib/medicineData";
import { medicineFields } from "@/lib/medicines";

// Edit a medicine: name, strength, who takes it, daily dose, low-stock mark,
// or put it away (archived) once nobody takes it any more.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await ownedMedicine(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = medicineFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the medicine a name." }, { status: 400 });
  const f = parsed.data;
  await prisma.medicine.update({
    where: { id },
    data: {
      name: f.name,
      strength: f.strength,
      unit: f.unit,
      forWhom: f.forWhom,
      dailyDose: f.dailyDose,
      lowStockAt: f.lowStockAt,
      notes: f.notes,
      ...(f.archived !== undefined ? { archived: f.archived } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

// Remove a medicine with its packs and dose history.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await ownedMedicine(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.$transaction([
    prisma.medicineDose.deleteMany({ where: { medicineId: id } }),
    prisma.medicineStock.deleteMany({ where: { medicineId: id } }),
    prisma.medicine.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
