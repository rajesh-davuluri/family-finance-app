import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { deleteInstrumentCascade } from "@/lib/cascadeDelete";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  archived: z.boolean().optional(),
});

async function assertOwnership(instrumentId: string, householdId: string) {
  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument || instrument.householdId !== householdId) return null;
  return instrument;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const existing = await assertOwnership(id, user.householdId);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await prisma.paymentInstrument.update({ where: { id }, data: parsed.data });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const existing = await assertOwnership(id, user.householdId);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    await deleteInstrumentCascade(id);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
