import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const transfer = await prisma.transfer.findUnique({ where: { id } });
  if (!transfer || transfer.householdId !== user.householdId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await prisma.transfer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
