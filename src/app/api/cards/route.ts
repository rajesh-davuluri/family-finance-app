import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { loadCards } from "@/lib/cardData";
import { loadCardCheckStatuses } from "@/lib/cardCheckData";

// Every active credit card with its statement snapshot: last statement,
// paid since, left to pay, new charges, owed now.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  const [cards, checks] = await Promise.all([loadCards(user.householdId, today), loadCardCheckStatuses(user.householdId)]);
  // The last check against the card's own balance, re-tested now.
  return NextResponse.json({ today, cards: cards.map((c) => ({ ...c, lastCheck: checks.get(c.id) ?? null })) });
}
