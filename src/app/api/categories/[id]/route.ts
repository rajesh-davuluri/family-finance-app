import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { deleteCategoryCascade } from "@/lib/cascadeDelete";
import { CategoryKind, isKindAllowed } from "@/lib/categoryKind";
import { CategoryGroup } from "@/lib/categoryGroups";

// Set (or clear, with null) how a category's transactions count in totals,
// and/or which group it rolls up into.
const patchSchema = z
  .object({ kind: CategoryKind.nullable().optional(), group: CategoryGroup.nullable().optional() })
  .refine((d) => d.kind !== undefined || d.group !== undefined, { message: "Nothing to change." });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const category = await prisma.transactionCategory.findUnique({ where: { id } });
  if (!category || category.householdId !== user.householdId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { kind, group } = parsed.data;
  const direction = category.direction === "INCOME" ? "INCOME" : "EXPENSE";
  if (kind && !isKindAllowed(kind, direction)) {
    return NextResponse.json({ error: "That type doesn't fit this category's direction." }, { status: 400 });
  }

  const updated = await prisma.transactionCategory.update({
    where: { id },
    data: { ...(kind !== undefined ? { kind } : {}), ...(group !== undefined ? { group } : {}) },
  });
  return NextResponse.json(updated);
}

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
