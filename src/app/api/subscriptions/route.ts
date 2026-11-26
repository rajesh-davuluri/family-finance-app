import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { loadSubscriptions } from "@/lib/subscriptionData";
import { totals } from "@/lib/subscriptions";

// Subscriptions found in the household's transactions, with their alerts
// and what they cost. Recomputed on every request; only Keep/Cancel is stored.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  const subscriptions = await loadSubscriptions(user.householdId, today);
  return NextResponse.json({ today, subscriptions, totals: totals(subscriptions) });
}
