import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { loadYearAhead, plannedFields, plannedItem } from "@/lib/yearAheadData";

// The Year ahead page's inputs: the planned expenses, the paychecks to come,
// what's set aside so far and what could be added from policies and bills.
// The page runs the plan itself (src/lib/yearAhead.ts).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(await loadYearAhead(user.householdId, calendarDateInZone()));
}

// Add a planned expense.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = plannedFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the name, amount and date." }, { status: 400 });
  const f = parsed.data;
  const row = await prisma.plannedExpense.create({
    data: { householdId: user.householdId, name: f.name, amount: f.amount, currency: f.currency, dueDate: new Date(`${f.dueDate}T00:00:00Z`), repeatMonths: f.repeatMonths, sourceKey: f.sourceKey ?? null },
  });
  return NextResponse.json(plannedItem(row), { status: 201 });
}

// What's set aside so far, and the amount meant for each paycheck (null: go
// by what the plan works out).
const settings = z.object({
  setAsideUsd: z.number().min(0).max(100_000_000).optional(),
  perPaydayUsd: z.number().min(0).max(1_000_000).nullable().optional(),
});

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = settings.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the amount." }, { status: 400 });
  await prisma.household.update({
    where: { id: user.householdId },
    data: { yearAheadSetAsideUsd: parsed.data.setAsideUsd, yearAheadPerPaydayUsd: parsed.data.perPaydayUsd },
  });
  return NextResponse.json({ ok: true });
}
