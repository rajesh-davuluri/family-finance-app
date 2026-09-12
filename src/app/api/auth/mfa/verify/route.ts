import { NextResponse } from "next/server";
import { authenticator } from "otplib";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { decryptField } from "@/lib/encryption";

// Step 2 of enabling MFA: confirm the person's authenticator app is
// actually producing valid codes before flipping mfaEnabled on.
export async function POST(req: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { token } = await req.json();
  const user = await prisma.user.findUnique({ where: { id: currentUser.id } });
  if (!user?.mfaSecretEncrypted) {
    return NextResponse.json({ error: "Call /api/auth/mfa/setup first." }, { status: 400 });
  }

  const secret = decryptField(user.mfaSecretEncrypted);
  const valid = token && authenticator.verify({ token, secret });
  if (!valid) {
    return NextResponse.json({ error: "Invalid code — check the time on your device and try again." }, { status: 400 });
  }

  await prisma.user.update({ where: { id: currentUser.id }, data: { mfaEnabled: true } });
  return NextResponse.json({ ok: true });
}
