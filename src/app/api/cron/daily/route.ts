import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { generateRecurring, sendReminders } from "@/lib/dailyJobs";

// The one daily scheduled run (vercel.json): recurring transactions first, so
// today's bills count in the budget alerts, then the reminders. One run wakes
// the serverless database once a day. Vercel Cron sends CRON_SECRET as a
// bearer token.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const recurring = await generateRecurring();
  const reminders = await sendReminders();
  return NextResponse.json({ recurring, reminders });
}
