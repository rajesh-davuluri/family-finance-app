import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { forwardingAddress, householdToken } from "@/lib/inboundEmail";

// What the Settings page needs to set up adding transactions by email: the
// household's private token (for the Gmail script) and, if Postmark is
// configured, its forwarding address. Both null while INBOUND_EMAIL_SECRET
// isn't set.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({
    token: householdToken(user.householdId),
    address: forwardingAddress(user.householdId),
  });
}
