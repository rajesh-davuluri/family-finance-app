import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { detectHouseholdRecurring } from "@/lib/recurringData";

// Recurring bills found in the household's own history, with how much of
// each paycheck to set aside for them. Nothing is stored -- it's recomputed
// from transactions on every request.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  const { bills, frequent } = await detectHouseholdRecurring(user.householdId, today);
  return NextResponse.json({ today, bills, frequent });
}
