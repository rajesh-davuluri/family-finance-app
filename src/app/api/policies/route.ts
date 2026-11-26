import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { policyData, policyFields, policyInclude, policyJson } from "@/lib/policyData";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const policies = await prisma.insurancePolicy.findMany({
    where: { householdId: user.householdId },
    include: policyInclude,
    orderBy: [{ nextDueDate: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(policies.map(policyJson));
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = policyFields.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const created = await prisma.insurancePolicy.create({
    data: {
      ...policyData(parsed.data),
      kind: parsed.data.kind,
      insurer: parsed.data.insurer,
      householdId: user.householdId,
    },
    include: policyInclude,
  });
  return NextResponse.json(policyJson(created), { status: 201 });
}
