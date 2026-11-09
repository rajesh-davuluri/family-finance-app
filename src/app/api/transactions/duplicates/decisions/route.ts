import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { rememberNotDuplicates } from "@/lib/duplicateData";

// "Not a duplicate — keep both": remembered for the household, so the pair
// isn't raised again on any device.
const schema = z.object({ pairs: z.array(z.object({ a: z.string().min(1).max(64), b: z.string().min(1).max(64) })).min(1).max(500) });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid pairs." }, { status: 400 });
  await rememberNotDuplicates(user.householdId, parsed.data.pairs.map((p) => [p.a, p.b]));
  return NextResponse.json({ ok: true });
}
