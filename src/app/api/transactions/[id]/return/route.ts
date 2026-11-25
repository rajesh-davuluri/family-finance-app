import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// A purchase's return: set or clear the return-by date, mark it being sent
// back (with the refund expected) or kept, or clear it all.
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("window"), returnBy: ymd.nullable() }),
  z.object({ action: z.literal("returning"), sentOn: ymd, expected: z.number().positive().max(10_000_000) }),
  z.object({ action: z.literal("kept") }),
  z.object({ action: z.literal("clear") }),
]);

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const t = await prisma.transaction.findUnique({ where: { id } });
  if (!t || t.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid return details." }, { status: 400 });
  const f = parsed.data;
  const date = (d: string) => new Date(`${d}T00:00:00Z`);
  const data =
    f.action === "window"
      ? { returnBy: f.returnBy ? date(f.returnBy) : null }
      : f.action === "returning"
        ? { returnState: "RETURNING", returnSentOn: date(f.sentOn), returnExpected: f.expected, refundTxnId: null }
        : f.action === "kept"
          ? { returnState: "KEPT", refundTxnId: null }
          : { returnState: null, returnSentOn: null, returnExpected: null, refundTxnId: null, returnBy: null };
  await prisma.transaction.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}
