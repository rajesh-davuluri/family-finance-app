import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { describeExisting, loadForDuplicateCheck, pairKey, settledPairs } from "@/lib/duplicateData";
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
  const [txns, settled] = await Promise.all([loadForDuplicateCheck(user.householdId, from, today), settledPairs(user.householdId)]);
  const byId = new Map(txns.map((t) => [t.id, t]));
  // A bill split by category is the itemised record: keep it and offer to
  // remove the plain copy; two split bills are left alone.
  const split = (id: string) => !!byId.get(id)?.splitGroupId;
  const pairs = findPairs(txns, (a, b) => settled.has(pairKey(a, b)))
    .filter((p) => !(split(p.keep) && split(p.remove)))
    // Pairs already confirmed as not duplicates aren't asked about again.
    .filter((p) => !settled.has(pairKey(p.keep, p.remove)))
    .map((p) => (split(p.remove) ? { ...p, keep: p.remove, remove: p.keep } : p))
    .map((p) => ({
    ...p,
    keepTxn: describeExisting(byId.get(p.keep)!),
    removeTxn: describeExisting(byId.get(p.remove)!),
  }));
  return NextResponse.json({ pairs });
}
