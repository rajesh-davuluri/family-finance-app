import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { deleteCategoryCascade } from "@/lib/cascadeDelete";

const deleteSchema = z.object({ reassignToCategoryId: z.string().optional() });

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const category = await prisma.transactionCategory.findUnique({ where: { id } });
  if (!category || category.householdId !== user.householdId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    // no body sent — fine, reassignToCategoryId is optional
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    await deleteCategoryCascade(id, parsed.data.reassignToCategoryId);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
