import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { LOAN_TYPES, findOrAddPerson, recordLoanMoney, wayOf } from "@/lib/personalLoanData";

// Add Transaction's loan types: money lent, borrowed or paid back, with a
// person picked by name (added to Lent & borrowed if they're new).
const body = z.object({
  type: z.enum(LOAN_TYPES),
  person: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).optional(),
  amount: z.number().positive().max(10_000_000),
  instrumentId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the person, the amount, the account and the date." }, { status: 400 });
  const f = parsed.data;
  const person = await findOrAddPerson(user.householdId, f.person, f.phone);
  const r = await recordLoanMoney({
    householdId: user.householdId,
    userId: user.id,
    personId: person.id,
    personName: person.name,
    way: wayOf(f.type),
    type: f.type,
    amount: f.amount,
    instrumentId: f.instrumentId,
    date: f.date,
    notes: f.notes,
  });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ id: r.id, person: { id: person.id, name: person.name, created: person.created } }, { status: 201 });
}
