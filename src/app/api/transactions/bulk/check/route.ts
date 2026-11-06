import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { describeExisting, loadForDuplicateCheck } from "@/lib/duplicateData";
import { matchRows } from "@/lib/duplicates";

// Pre-import duplicate check for the CSV/PDF import flow: for each row about
// to be imported, find a transaction already in the app that's likely the
// same purchase (src/lib/duplicates.ts) -- the same amount on this account
// within a few days, e.g. typed in by hand or sent from Telegram before the
// statement arrived. Nothing is written; the import page uses the result to
// flag rows (and leave the likely ones unchecked) before anything is inserted.

const checkSchema = z.object({
  instrumentId: z.string(),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number(),
        description: z.string().optional(),
      })
    )
    .min(1)
    .max(1000),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = checkSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { instrumentId, rows } = parsed.data;

  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument || instrument.householdId !== user.householdId) {
    return NextResponse.json({ error: "Invalid payment instrument." }, { status: 400 });
  }

  const dates = rows.map((r) => r.date).sort();
  const existing = await loadForDuplicateCheck(user.householdId, dates[0], dates[dates.length - 1]);
  const byId = new Map(existing.map((e) => [e.id, e]));
  const found = matchRows(
    rows.map((r) => ({
      date: r.date,
      amount: Math.abs(r.amount),
      // Statement rows are in the account's currency.
      currency: instrument.currency,
      instrumentId,
      notes: r.description ?? null,
      source: "IMPORTED",
    })),
    existing
  );

  const matches = found.map((m) => {
    if (!m) return null;
    const e = byId.get(m.id)!;
    return {
      ...describeExisting(e),
      sameInstrument: e.instrumentId === instrumentId,
      confidence: m.confidence,
      daysApart: m.daysApart,
      reason: m.reason,
    };
  });
  return NextResponse.json({ matches });
}
