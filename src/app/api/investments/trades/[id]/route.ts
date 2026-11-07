import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { holdingOf } from "@/lib/investmentData";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const trade = await prisma.investmentTrade.findUnique({ where: { id } });
  if (!trade || !(await holdingOf(trade.holdingId, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.investmentTrade.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
