import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";

// Money added to or taken out of the typed-in emergency fund, and who put it
// in. The dashboard's card adds these to the starting amount.
const schema = z.object({
  amountUsd: z.number().positive().max(10_000_000),
  direction: z.enum(["IN", "OUT"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  byUserId: z.string().nullable(), // null = joint
  note: z.string().trim().max(200).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the amount and date." }, { status: 400 });
  const { amountUsd, direction, date, byUserId, note } = parsed.data;
  if (Number.isNaN(Date.parse(date))) return NextResponse.json({ error: "Check the date." }, { status: 400 });
  if (date > calendarDateInZone()) return NextResponse.json({ error: "The date can't be in the future." }, { status: 400 });
  if (byUserId) {
    const member = await prisma.user.findFirst({ where: { id: byUserId, householdId: user.householdId }, select: { id: true } });
    if (!member) return NextResponse.json({ error: "Pick someone in your household." }, { status: 400 });
  }
  const entry = await prisma.emergencyFundEntry.create({
    data: {
      householdId: user.householdId,
      date: new Date(`${date}T00:00:00.000Z`),
      amountUsd: direction === "IN" ? amountUsd : -amountUsd,
      byUserId,
      note: note || null,
    },
    select: { id: true },
  });
  return NextResponse.json(entry, { status: 201 });
}
