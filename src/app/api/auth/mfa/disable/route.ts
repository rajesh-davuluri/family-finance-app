import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export async function POST() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await prisma.user.update({
    where: { id: currentUser.id },
    data: { mfaEnabled: false, mfaSecretEncrypted: null },
  });
  return NextResponse.json({ ok: true });
}
