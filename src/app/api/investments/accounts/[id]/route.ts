import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { accountFields, accountOf } from "@/lib/investmentData";
import { deleteInvestmentAccountCascade } from "@/lib/cascadeDelete";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await accountOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = accountFields.partial().safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  const blank = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
  const account = await prisma.investmentAccount.update({
    where: { id },
    data: {
      name: d.name,
      broker: blank(d.broker),
      country: d.country,
      currency: d.currency,
      kind: d.kind,
      owner: blank(d.owner),
      loginNote: blank(d.loginNote),
      notes: blank(d.notes),
      archived: d.archived,
    },
  });
  return NextResponse.json(account);
}

// Deletes the account with its holdings and their trades.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await accountOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await deleteInvestmentAccountCascade(id);
  return NextResponse.json({ ok: true });
}
