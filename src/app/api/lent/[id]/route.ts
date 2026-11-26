import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { personFields } from "@/lib/personalLoanData";

async function owned(id: string, householdId: string) {
  const p = await prisma.loanContact.findUnique({ where: { id } });
  return p && p.householdId === householdId ? p : null;
}

// Edit a person: name, what was owed before the app's records, phone, note.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await owned(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = personFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the person a name." }, { status: 400 });
  const f = parsed.data;
  const clash = await prisma.loanContact.findUnique({ where: { householdId_name: { householdId: user.householdId, name: f.name } } });
  if (clash && clash.id !== id) return NextResponse.json({ error: `${f.name} is already on the list.` }, { status: 409 });
  await prisma.loanContact.update({
    where: { id },
    data: {
      name: f.name,
      openingBalance: f.openingBalance ?? 0,
      openingDate: f.openingDate ? new Date(`${f.openingDate}T00:00:00Z`) : null,
      phone: f.phone || null,
      notes: f.notes || null,
    },
  });
  return NextResponse.json({ ok: true });
}

// Remove a person: their transactions stay, just no longer linked to anyone.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await owned(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.$transaction([
    prisma.transaction.updateMany({ where: { loanContactId: id, householdId: user.householdId }, data: { loanContactId: null } }),
    prisma.loanContact.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
