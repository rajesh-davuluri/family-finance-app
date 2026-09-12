import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: currentUser.id }, select: { mfaEnabled: true } });
  return NextResponse.json({ mfaEnabled: user?.mfaEnabled ?? false });
}
