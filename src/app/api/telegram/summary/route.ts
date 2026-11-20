import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Turns the household's money summary on Telegram on or off.
const body = z.object({ on: z.boolean() });

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid setting." }, { status: 400 });
  await prisma.household.update({ where: { id: user.householdId }, data: { moneySummary: parsed.data.on } });
  return NextResponse.json({ moneySummary: parsed.data.on });
}
