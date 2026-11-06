import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { describeExisting, loadForDuplicateCheck } from "@/lib/duplicateData";
import { findPairs } from "@/lib/duplicates";

// Likely duplicates among transactions already saved in the last few months,
// for the Transactions page to review. Nothing is changed here -- removing
// one goes through the normal DELETE /api/transactions/[id].
const LOOKBACK_DAYS = 180;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const today = calendarDateInZone();
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const txns = await loadForDuplicateCheck(user.householdId, from, today);
  const byId = new Map(txns.map((t) => [t.id, t]));
  const pairs = findPairs(txns).map((p) => ({
    ...p,
    keepTxn: describeExisting(byId.get(p.keep)!),
    removeTxn: describeExisting(byId.get(p.remove)!),
  }));
  return NextResponse.json({ pairs });
}
