import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Each household forwards bank alerts to its own address,
//   <mailbox>+<token>@inbound.postmarkapp.com
// where <token> is an HMAC of the household id. Deriving it (rather than
// storing it) means no schema change; rotating INBOUND_EMAIL_SECRET gives
// every household a new address and retires the old ones.

const TOKEN_LENGTH = 24;

function secret(): string | null {
  const s = process.env.INBOUND_EMAIL_SECRET;
  return s && s.length >= 16 ? s : null;
}

export function householdToken(householdId: string): string | null {
  const s = secret();
  if (!s) return null;
  return crypto.createHmac("sha256", s).update(householdId).digest("hex").slice(0, TOKEN_LENGTH);
}

// POSTMARK_INBOUND_ADDRESS is the server's inbound address from Postmark,
// e.g. "abc123@inbound.postmarkapp.com".
export function forwardingAddress(householdId: string): string | null {
  const base = process.env.POSTMARK_INBOUND_ADDRESS;
  const token = householdToken(householdId);
  if (!base || !token || !base.includes("@")) return null;
  const [local, domain] = base.split("@");
  return `${local}+${token}@${domain}`;
}

export async function householdForToken(token: string): Promise<string | null> {
  if (!token || token.length !== TOKEN_LENGTH) return null;
  // A handful of households -- checking each is cheaper than storing tokens.
  const households = await prisma.household.findMany({ select: { id: true } });
  for (const h of households) {
    const expected = householdToken(h.id);
    if (expected && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return h.id;
  }
  return null;
}

// Postmark sends the webhook with the basic-auth credentials embedded in the
// webhook URL configured on its side.
export function webhookAuthorized(req: Request): boolean {
  const user = process.env.INBOUND_WEBHOOK_USER;
  const pass = process.env.INBOUND_WEBHOOK_PASSWORD;
  if (!user || !pass) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
