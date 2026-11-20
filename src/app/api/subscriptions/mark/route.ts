import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Keep or Cancel a subscription, or clear the choice (status null).
const body = z.object({
  key: z.string().min(3).max(200),
  status: z.enum(["KEEP", "CANCEL"]).nullable(),
  amount: z.number().min(0).max(100_000_000).nullable().optional(),
});

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid choice." }, { status: 400 });
  const { key, status, amount } = parsed.data;
  const householdId = user.householdId;
  if (status === null) {
    await prisma.subscriptionMark.deleteMany({ where: { householdId, key } });
    return NextResponse.json({ ok: true });
  }
  const data = { status, amount: amount ?? null, markedAt: new Date() };
  await prisma.subscriptionMark.upsert({
    where: { householdId_key: { householdId, key } },
    create: { householdId, key, ...data },
    update: data,
  });
  return NextResponse.json({ ok: true });
}
