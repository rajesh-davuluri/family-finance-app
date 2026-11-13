import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { generateRecurring } from "@/lib/dailyJobs";

// Recurring transactions now. The daily schedule runs this through
// /api/cron/daily; this route is for the "Generate now" button on the
// /recurring page. Protected by CRON_SECRET.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await generateRecurring());
}
