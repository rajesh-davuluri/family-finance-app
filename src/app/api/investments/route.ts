import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { currentFx, householdAccounts } from "@/lib/investmentData";

// Every investment account with its holdings and trades, and the USD/INR
// rate. The page computes positions and analysis with src/lib/investments.ts.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const [accounts, fx] = await Promise.all([householdAccounts(user.householdId), currentFx()]);
  return NextResponse.json({ accounts, fx }, { headers: { "Cache-Control": "private, no-store" } });
}
