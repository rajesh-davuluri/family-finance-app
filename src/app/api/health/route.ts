import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Unauthenticated health check for diagnosing login problems on a deployed
// instance. Reports only whether the database answers and whether each
// required environment variable is set -- never their values.
export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | string = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    database = err instanceof Error ? err.message.split("\n").filter(Boolean).slice(-1)[0] ?? "error" : "error";
  }

  const env = Object.fromEntries(
    ["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "FIELD_ENCRYPTION_KEY"].map((k) => [k, !!process.env[k]])
  );
  const encryptionKeyValid = process.env.FIELD_ENCRYPTION_KEY?.length === 64;

  const ok = database === "ok" && Object.values(env).every(Boolean) && encryptionKeyValid;
  return NextResponse.json(
    { ok, database, env, encryptionKeyValid, nextAuthUrl: process.env.NEXTAUTH_URL ?? null },
    { status: ok ? 200 : 503 }
  );
}
