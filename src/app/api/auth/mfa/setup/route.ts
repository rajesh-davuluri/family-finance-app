import { NextResponse } from "next/server";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { encryptField } from "@/lib/encryption";

// Step 1 of enabling MFA: generate a secret, store it (encrypted) but leave
// mfaEnabled false until the person proves they can generate a valid code
// in /api/auth/mfa/verify. Returns a QR code the person scans in their
// authenticator app.
export async function POST() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const secret = authenticator.generateSecret();
  await prisma.user.update({
    where: { id: currentUser.id },
    data: { mfaSecretEncrypted: encryptField(secret), mfaEnabled: false },
  });

  const otpauthUrl = authenticator.keyuri(currentUser.email ?? currentUser.id, "Family Finance", secret);
  const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

  return NextResponse.json({ qrDataUrl, secret });
}
