import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const household = await prisma.household.findUnique({
    where: { id: user.householdId },
    include: { users: { select: { id: true, name: true, email: true, role: true, mfaEnabled: true } } },
  });
  return NextResponse.json(household);
}
