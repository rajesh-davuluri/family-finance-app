import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { holdingOf, tradeData, tradeFields } from "@/lib/investmentData";

// Records a buy, a sale or a dividend.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await holdingOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = tradeFields.safeParse(await req.json());
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    return NextResponse.json({ error: msg ?? parsed.error.flatten() }, { status: 400 });
  }
  const trade = await prisma.investmentTrade.create({ data: { ...tradeData(parsed.data), holdingId: id } });
  return NextResponse.json(trade, { status: 201 });
}
