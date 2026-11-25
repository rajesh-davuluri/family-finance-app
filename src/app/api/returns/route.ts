import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { loadReturns } from "@/lib/returnsData";

// Purchases with a return window or a return in progress, with their
// refunds (paired automatically) and what's still owed back.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  return NextResponse.json({ today, ...(await loadReturns(user.householdId, today)) });
}
