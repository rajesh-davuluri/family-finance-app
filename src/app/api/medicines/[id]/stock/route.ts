import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { ownedMedicine, toDate } from "@/lib/medicineData";
import { stockFields } from "@/lib/medicines";

// Add a pack (strip, bottle, box) with the expiry date printed on it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await ownedMedicine(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = stockFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "How many are in the pack? Enter a number above 0." }, { status: 400 });
  const f = parsed.data;
  const pack = await prisma.medicineStock.create({
    data: {
      medicineId: id,
      quantity: f.quantity,
      remaining: Math.min(f.remaining ?? f.quantity, f.quantity),
      expiresOn: f.expiresOn ? toDate(f.expiresOn) : null,
      addedOn: toDate(f.addedOn ?? calendarDateInZone()),
      note: f.note,
    },
  });
  return NextResponse.json({ id: pack.id }, { status: 201 });
}
