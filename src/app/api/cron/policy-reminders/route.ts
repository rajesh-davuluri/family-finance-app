import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { sendReminders } from "@/lib/dailyJobs";

// Reminders now. The daily schedule runs this through /api/cron/daily.
// Protected by CRON_SECRET.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await sendReminders());
}
