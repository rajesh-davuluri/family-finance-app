import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { toDate } from "@/lib/medicineData";

async function ownedPack(stockId: string, householdId: string) {
  const p = await prisma.medicineStock.findUnique({ where: { id: stockId }, include: { medicine: { select: { householdId: true } } } });
  return p && p.medicine.householdId === householdId ? p : null;
}

const packEdit = z.object({
  // Count what's actually left and correct it.
  remaining: z.coerce.number().min(0).max(99_999).optional(),
  expiresOn: z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  // Thrown away: what's left goes to 0 and the pack is marked discarded.
  discard: z.boolean().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ stockId: string }> }) {
  const { stockId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const pack = await ownedPack(stockId, user.householdId);
  if (!pack) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = packEdit.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter how many are left, 0 or more." }, { status: 400 });
  const f = parsed.data;
  if (f.discard) {
    await prisma.medicineStock.update({ where: { id: stockId }, data: { remaining: 0, discardedOn: toDate(calendarDateInZone()) } });
    return NextResponse.json({ ok: true });
  }
  await prisma.medicineStock.update({
    where: { id: stockId },
    data: {
      ...(f.remaining !== undefined ? { remaining: f.remaining, quantity: Math.max(f.remaining, Number(pack.quantity)) } : {}),
      ...(f.expiresOn !== undefined ? { expiresOn: f.expiresOn ? toDate(f.expiresOn) : null } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

// A pack added by mistake. Doses that came out of it stay in the history.
export async function DELETE(_req: Request, { params }: { params: Promise<{ stockId: string }> }) {
  const { stockId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await ownedPack(stockId, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.medicineStock.delete({ where: { id: stockId } });
  return NextResponse.json({ ok: true });
}
