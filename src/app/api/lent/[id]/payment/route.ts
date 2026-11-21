import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { recordLoanMoney } from "@/lib/personalLoanData";

// Record money with a person: "They paid me" (money in: they repay you, or
// you borrow) or "I paid them" (money out: you lend, or repay what you
// borrowed). Saved as a transaction on the chosen account, in a loan
// category (neither income nor spending), linked to the person.
const body = z.object({
  way: z.enum(["IN", "OUT"]),
  amount: z.number().positive().max(10_000_000),
  instrumentId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the amount, the account and the date." }, { status: 400 });
  const f = parsed.data;

  const person = await prisma.loanContact.findUnique({ where: { id } });
  if (!person || person.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const r = await recordLoanMoney({ householdId: user.householdId, userId: user.id, personId: person.id, personName: person.name, way: f.way, amount: f.amount, instrumentId: f.instrumentId, date: f.date, notes: f.notes });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ id: r.id }, { status: 201 });
}
