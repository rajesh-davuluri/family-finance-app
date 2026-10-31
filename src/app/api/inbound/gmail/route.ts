import { NextResponse } from "next/server";
import { z } from "zod";
import { householdForToken } from "@/lib/inboundEmail";
import { processInboundEmail } from "@/lib/processInboundEmail";

// Receives bank card-alert emails from the Google Apps Script a household
// member runs in their own Gmail (the script is shown on the Settings page).
// The household's private token, sent as a bearer token, is the credential.
//
// Answers 200 for every alert it has dealt with -- including ones it chose
// not to add -- so the script marks them done; only auth or a malformed
// request is an error the script should retry or surface.

const schema = z.object({
  subject: z.string().max(1000),
  textBody: z.string().max(100_000).optional(),
  htmlBody: z.string().max(500_000).optional(),
  date: z.string().optional(),
});

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const householdId = await householdForToken(token);
  if (!householdId) return NextResponse.json({ error: "Unknown or missing token." }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const status = await processInboundEmail(householdId, {
    subject: parsed.data.subject,
    textBody: parsed.data.textBody,
    htmlBody: parsed.data.htmlBody,
    receivedAt: parsed.data.date,
  });
  return NextResponse.json({ status });
}
