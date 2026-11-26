import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { addMonths } from "@/lib/cashPlan";
import { plannedItem } from "@/lib/yearAheadData";

// Mark a planned expense as paid: a repeating one moves on to its next due
// date, a one-time one comes off the list. The money leaves what's set aside
// (unless it was paid from somewhere else).
const body = z.object({ fromSetAside: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const row = await prisma.plannedExpense.findUnique({ where: { id } });
  if (!row || row.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const item = plannedItem(row);

  const household = await prisma.household.findUnique({ where: { id: user.householdId }, select: { yearAheadSetAsideUsd: true } });
  const pot = household?.yearAheadSetAsideUsd != null ? Number(household.yearAheadSetAsideUsd) : 0;
  const setAsideUsd = parsed.data.fromSetAside === false ? pot : Math.round(Math.max(0, pot - item.usd) * 100) / 100;

  await prisma.$transaction([
    row.repeatMonths
      ? prisma.plannedExpense.update({ where: { id }, data: { dueDate: new Date(`${addMonths(item.dueDate, row.repeatMonths)}T00:00:00Z`) } })
      : prisma.plannedExpense.delete({ where: { id } }),
    prisma.household.update({ where: { id: user.householdId }, data: { yearAheadSetAsideUsd: setAsideUsd } }),
  ]);
  return NextResponse.json({ ok: true, setAsideUsd });
}
