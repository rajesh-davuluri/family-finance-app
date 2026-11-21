import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Just the names on Lent & borrowed, for Add Transaction's person picker --
// a light query, asked for only when a loan type is chosen.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const people = await prisma.loanContact.findMany({ where: { householdId: user.householdId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return NextResponse.json({ people });
}
