import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { loadCashPlanInputs } from "@/lib/cashPlanData";
import { DEFAULT_CUSHION_USD } from "@/lib/cashPlan";

// The payday planner's inputs: bank cash, paychecks, bills, card bills and
// loan instalments for the next 30 days, and the cushion. The page runs the
// plan itself (src/lib/cashPlan.ts) so each "what if" is instant.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const [inputs, household] = await Promise.all([
    loadCashPlanInputs(user.householdId, calendarDateInZone()),
    prisma.household.findUnique({ where: { id: user.householdId }, select: { cashCushionUsd: true } }),
  ]);
  const cushionUsd = household?.cashCushionUsd != null ? Number(household.cashCushionUsd) : DEFAULT_CUSHION_USD;
  return NextResponse.json({ ...inputs, cushionUsd });
}

const schema = z.object({ cushionUsd: z.number().min(0).max(1_000_000) });

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the amount." }, { status: 400 });
  await prisma.household.update({ where: { id: user.householdId }, data: { cashCushionUsd: parsed.data.cushionUsd } });
  return NextResponse.json({ ok: true });
}
