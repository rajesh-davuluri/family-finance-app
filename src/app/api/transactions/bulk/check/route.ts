import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Pre-import duplicate check for the CSV import flow: for each row about to
// be imported, find an existing transaction in this household with the same
// calendar date and amount. Nothing is written -- the import page uses the
// result to flag rows (and leave them unchecked) before anything is inserted.

const checkSchema = z.object({
  instrumentId: z.string(),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number(),
      })
    )
    .min(1)
    .max(1000),
});

const toCents = (n: number) => Math.round(n * 100);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = checkSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { instrumentId, rows } = parsed.data;

  // Dates are stored as UTC midnight of the chosen calendar day (see
  // src/lib/formatDate.ts), so the ISO Y-M-D prefix is the calendar date.
  const dates = rows.map((r) => r.date).sort();
  const from = new Date(`${dates[0]}T00:00:00Z`);
  const to = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const existing = await prisma.transaction.findMany({
    where: { householdId: user.householdId, date: { gte: from, lt: to } },
    include: { category: { select: { name: true } }, instrument: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const byKey = new Map<string, typeof existing>();
  for (const t of existing) {
    const key = `${t.date.toISOString().slice(0, 10)}|${toCents(Number(t.amount))}`;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }

  // Match one-to-one: two identical $4.50 charges in the file against one
  // existing $4.50 transaction should flag only one of them. Prefer an
  // existing transaction on the same account being imported into.
  const used = new Set<string>();
  const matches = rows.map((r) => {
    const candidates = (byKey.get(`${r.date}|${toCents(Math.abs(r.amount))}`) ?? []).filter((t) => !used.has(t.id));
    const match = candidates.find((t) => t.instrumentId === instrumentId) ?? candidates[0];
    if (!match) return null;
    used.add(match.id);
    return {
      id: match.id,
      date: match.date.toISOString().slice(0, 10),
      amount: Number(match.amount),
      currency: match.currency,
      notes: match.notes,
      categoryName: match.category.name,
      instrumentName: match.instrument.name,
      sameInstrument: match.instrumentId === instrumentId,
    };
  });

  return NextResponse.json({ matches });
}
