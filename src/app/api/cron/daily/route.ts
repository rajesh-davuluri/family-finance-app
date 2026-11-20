import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { generateRecurring, sendReminders, sendSummaries } from "@/lib/dailyJobs";

// The one daily scheduled run (vercel.json): recurring transactions first, so
// today's bills count in the budget alerts, then the reminders. One run wakes
// the serverless database once a day. Vercel Cron sends CRON_SECRET as a
// bearer token.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const recurring = await generateRecurring();
  const reminders = await sendReminders();
  // Last, and on its own: a problem here mustn't undo the jobs above.
  const summaries = await sendSummaries().catch((e) => ({ error: String(e) }));
  return NextResponse.json({ recurring, reminders, summaries });
}
