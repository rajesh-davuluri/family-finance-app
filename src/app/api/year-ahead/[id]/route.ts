import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { plannedFields, plannedItem } from "@/lib/yearAheadData";

async function owned(id: string, householdId: string) {
  const row = await prisma.plannedExpense.findUnique({ where: { id } });
  return row && row.householdId === householdId ? row : null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await owned(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = plannedFields.omit({ sourceKey: true }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the name, amount and date." }, { status: 400 });
  const f = parsed.data;
  const row = await prisma.plannedExpense.update({
    where: { id },
    data: { name: f.name, amount: f.amount, currency: f.currency, dueDate: new Date(`${f.dueDate}T00:00:00Z`), repeatMonths: f.repeatMonths },
  });
  return NextResponse.json(plannedItem(row));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await owned(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.plannedExpense.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
