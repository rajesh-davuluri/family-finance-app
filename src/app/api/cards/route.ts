import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { loadCards } from "@/lib/cardData";

// Every active credit card with its statement snapshot: last statement,
// paid since, left to pay, new charges, owed now.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  return NextResponse.json({ today, cards: await loadCards(user.householdId, today) });
}
