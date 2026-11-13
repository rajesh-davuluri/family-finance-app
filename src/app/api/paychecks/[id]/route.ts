import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { detailData, hasDetail, paycheckDetailSchema } from "@/lib/paycheckDetail";

// Set (or clear) a paycheck's hours and pay period. The id is the Salary
// transaction's, so paychecks imported from a statement get them too.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = paycheckDetailSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the hours and dates." }, { status: 400 });

  const t = await prisma.transaction.findUnique({ where: { id }, select: { householdId: true, category: { select: { direction: true } } } });
  if (!t || t.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (t.category.direction !== "INCOME") return NextResponse.json({ error: "Only a paycheck can have hours." }, { status: 400 });

  if (!hasDetail(parsed.data)) {
    await prisma.paycheckDetail.deleteMany({ where: { transactionId: id } });
    return NextResponse.json({ ok: true });
  }
  const data = detailData(parsed.data);
  await prisma.paycheckDetail.upsert({ where: { transactionId: id }, create: { transactionId: id, ...data }, update: data });
  return NextResponse.json({ ok: true });
}
