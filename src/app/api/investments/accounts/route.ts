import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { accountFields } from "@/lib/investmentData";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = accountFields.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  const account = await prisma.investmentAccount.create({
    data: {
      name: d.name,
      broker: d.broker || null,
      country: d.country,
      currency: d.currency,
      kind: d.kind,
      owner: d.owner || null,
      loginNote: d.loginNote || null,
      notes: d.notes || null,
      householdId: user.householdId,
    },
  });
  return NextResponse.json(account, { status: 201 });
}
