import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { loadCloseOverview } from "@/lib/periodCloseData";

// Monthly close: every bank account and card with its latest period, where
// it stands, and its history of closes.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  return NextResponse.json({ today, ...(await loadCloseOverview(user.householdId, today)) });
}

// The difference (approx USD) that can be accepted without a note.
const body = z.object({ toleranceUsd: z.number().min(0).max(10_000) });

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the amount." }, { status: 400 });
  await prisma.household.update({ where: { id: user.householdId }, data: { closeToleranceUsd: parsed.data.toleranceUsd } });
  return NextResponse.json({ ok: true });
}
