import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { loadMedicines, toDate } from "@/lib/medicineData";
import { medicineFields, stockFields } from "@/lib/medicines";

// Medicines at home: each with what's left, expiry dates and doses taken.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  const [medicines, members] = await Promise.all([
    loadMedicines(user.householdId, today, { includeArchived }),
    prisma.user.findMany({ where: { householdId: user.householdId }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ today, medicines, members: members.map((m) => m.name) });
}

// Add a medicine, optionally with the first pack of it.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = medicineFields.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Give the medicine a name." }, { status: 400 });
  const f = parsed.data;
  const stock = body?.stock ? stockFields.safeParse(body.stock) : null;
  if (stock && !stock.success) return NextResponse.json({ error: "How many are in the pack? Enter a number above 0." }, { status: 400 });
  const today = calendarDateInZone();
  const m = await prisma.medicine.create({
    data: {
      householdId: user.householdId,
      name: f.name,
      strength: f.strength,
      unit: f.unit,
      forWhom: f.forWhom,
      dailyDose: f.dailyDose,
      lowStockAt: f.lowStockAt,
      notes: f.notes,
      ...(stock?.success
        ? {
            stock: {
              create: {
                quantity: stock.data.quantity,
                remaining: Math.min(stock.data.remaining ?? stock.data.quantity, stock.data.quantity),
                expiresOn: stock.data.expiresOn ? toDate(stock.data.expiresOn) : null,
                addedOn: toDate(stock.data.addedOn ?? today),
                note: stock.data.note,
              },
            },
          }
        : {}),
    },
  });
  return NextResponse.json({ id: m.id }, { status: 201 });
}
