import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// The signed-in user's own login times, for the Dashboard greeting.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true, lastLoginAt: true, previousLoginAt: true },
  });
  if (!me) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({
    name: me.name,
    lastLoginAt: me.lastLoginAt?.toISOString() ?? null,
    previousLoginAt: me.previousLoginAt?.toISOString() ?? null,
  });
}
