import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Link a transaction to a person (an existing one, or a new one by name), or
// unlink it (contactId null and no name).
const body = z.object({
  transactionId: z.string().min(1),
  contactId: z.string().nullable().optional(),
  newName: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a person." }, { status: 400 });
  const f = parsed.data;

  const txn = await prisma.transaction.findUnique({ where: { id: f.transactionId } });
  if (!txn || txn.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let contactId: string | null = null;
  if (f.newName) {
    const existing = await prisma.loanContact.findUnique({ where: { householdId_name: { householdId: user.householdId, name: f.newName } } });
    contactId = existing?.id ?? (await prisma.loanContact.create({ data: { householdId: user.householdId, name: f.newName } })).id;
  } else if (f.contactId) {
    const c = await prisma.loanContact.findUnique({ where: { id: f.contactId } });
    if (!c || c.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
    contactId = c.id;
  }
  await prisma.transaction.update({ where: { id: txn.id }, data: { loanContactId: contactId } });
  return NextResponse.json({ ok: true, contactId });
}
