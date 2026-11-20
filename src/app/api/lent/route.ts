import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { loadPeople, loadUnlinked, personFields } from "@/lib/personalLoanData";

// Lent & borrowed: everyone money moves to and from, with what's owed each
// way, and the transactions that look like loans but aren't linked yet.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  const people = await loadPeople(user.householdId);
  const unlinked = await loadUnlinked(user.householdId, today, people.map((p) => p.name));
  return NextResponse.json({ today, people, unlinked });
}


export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = personFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the person a name." }, { status: 400 });
  const f = parsed.data;
  const clash = await prisma.loanContact.findUnique({ where: { householdId_name: { householdId: user.householdId, name: f.name } } });
  if (clash) return NextResponse.json({ error: `${f.name} is already on the list.` }, { status: 409 });
  const person = await prisma.loanContact.create({
    data: {
      householdId: user.householdId,
      name: f.name,
      openingBalance: f.openingBalance ?? 0,
      openingDate: f.openingDate ? new Date(`${f.openingDate}T00:00:00Z`) : null,
      phone: f.phone || null,
      notes: f.notes || null,
    },
  });
  return NextResponse.json({ id: person.id, name: person.name }, { status: 201 });
}
