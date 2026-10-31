import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { forwardingAddress } from "@/lib/inboundEmail";

// The household's private address for forwarding bank alert emails, or null
// while the inbound-email environment variables aren't configured.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ address: forwardingAddress(user.householdId) });
}
