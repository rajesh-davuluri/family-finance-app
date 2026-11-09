import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// The rupees that arrived for one transfer (and any fee), from the
// service's receipt. inrReceived null removes it.
const schema = z.object({
  inrReceived: z.number().positive().max(1_000_000_000).nullable(),
  feeUsd: z.number().min(0).max(10_000).nullable().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the amounts." }, { status: 400 });

  const t = await prisma.transaction.findUnique({ where: { id }, select: { householdId: true, currency: true, amount: true } });
  if (!t || t.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (t.currency !== "USD") return NextResponse.json({ error: "Only transfers sent in dollars." }, { status: 400 });

  const { inrReceived, feeUsd } = parsed.data;
  if (inrReceived == null) {
    await prisma.remittanceDetail.deleteMany({ where: { transactionId: id } });
    return NextResponse.json({ ok: true });
  }
  // A rate far outside 50-200 rupees a dollar is a typo (a missing or extra digit).
  const rate = inrReceived / Number(t.amount);
  if (rate < 50 || rate > 200) {
    return NextResponse.json({ error: `That's ₹${rate.toFixed(2)} per dollar — check the amount received.` }, { status: 400 });
  }
  const data = { inrReceived, feeUsd: feeUsd ?? null };
  await prisma.remittanceDetail.upsert({ where: { transactionId: id }, create: { transactionId: id, ...data }, update: data });
  return NextResponse.json({ ok: true });
}
