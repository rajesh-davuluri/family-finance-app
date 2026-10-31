import { NextResponse } from "next/server";
import { householdForToken, webhookAuthorized } from "@/lib/inboundEmail";
import { processInboundEmail } from "@/lib/processInboundEmail";

// Postmark inbound webhook: a mailbox forwards bank card-alert emails to the
// household's private address, and each one becomes a transaction (see
// src/lib/processInboundEmail.ts).
//
// Always answers 200 once authorized -- a non-2xx makes Postmark retry the
// same email, which would only repeat the same outcome.

type PostmarkInbound = {
  MailboxHash?: string;
  OriginalRecipient?: string;
  To?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Date?: string;
};

function tokenFrom(payload: PostmarkInbound): string {
  if (payload.MailboxHash) return payload.MailboxHash;
  const to = payload.OriginalRecipient ?? payload.To ?? "";
  return to.match(/\+([a-f0-9]+)@/i)?.[1] ?? "";
}

export async function POST(req: Request) {
  if (!webhookAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const payload: PostmarkInbound = await req.json();
  const householdId = await householdForToken(tokenFrom(payload));
  if (!householdId) return NextResponse.json({ status: "ignored", reason: "unknown address" });

  const status = await processInboundEmail(householdId, {
    subject: payload.Subject ?? "",
    textBody: payload.TextBody,
    htmlBody: payload.HtmlBody,
    receivedAt: payload.Date,
  });
  return NextResponse.json({ status });
}
