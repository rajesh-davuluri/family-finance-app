import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { policyData, policyFields, policyInclude, policyJson, policyOf } from "@/lib/policyData";
import { deletePolicyCascade } from "@/lib/cascadeDelete";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await policyOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = policyFields.partial().safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await prisma.insurancePolicy.update({
    where: { id },
    data: policyData(parsed.data),
    include: policyInclude,
  });
  return NextResponse.json(policyJson(updated));
}

// Removes the policy and its documents. Premiums already paid stay as
// ordinary transactions (they were real money out).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await policyOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await deletePolicyCascade(id);
  return NextResponse.json({ ok: true });
}
