import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { describeExisting, loadForDuplicateCheck } from "@/lib/duplicateData";
import { DUPLICATE_WINDOW_DAYS, matchRows } from "@/lib/duplicates";
import { kindOf } from "@/lib/categoryKind";

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
        // Money into the account (a deposit, a payment received).
        moneyIn: z.boolean().optional(),
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
      moneyIn: r.moneyIn,
    })),
    existing
  );

  // Card payments and other moves between accounts may already be recorded
  // as transfers (e.g. entered on the Transfers page): same amount, same
  // direction for this account, within a few days.
  const transfers = await prisma.transfer.findMany({
    where: {
      householdId: user.householdId,
      OR: [{ fromInstrumentId: instrumentId }, { toInstrumentId: instrumentId }],
      date: {
        gte: new Date(Date.parse(`${dates[0]}T00:00:00Z`) - DUPLICATE_WINDOW_DAYS * 86_400_000),
        lt: new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + (DUPLICATE_WINDOW_DAYS + 1) * 86_400_000),
      },
    },
    include: { fromInstrument: { select: { name: true } }, toInstrument: { select: { name: true } } },
  });
  const usedTransfers = new Set<string>();
  const transferMatch = (r: (typeof rows)[number]) => {
    const t = transfers.find(
      (x) =>
        !usedTransfers.has(x.id) &&
        Math.round(Number(x.amount) * 100) === Math.round(Math.abs(r.amount) * 100) &&
        (r.moneyIn ? x.toInstrumentId === instrumentId : x.fromInstrumentId === instrumentId) &&
        Math.abs(Date.parse(`${r.date}T00:00:00Z`) - x.date.getTime()) <= DUPLICATE_WINDOW_DAYS * 86_400_000
    );
    if (!t) return null;
    usedTransfers.add(t.id);
    const days = Math.round(Math.abs(Date.parse(`${r.date}T00:00:00Z`) - t.date.getTime()) / 86_400_000);
    return {
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      amount: Number(t.amount),
      currency: t.currency,
      notes: t.notes,
      categoryName: `Transfer ${t.fromInstrument.name} → ${t.toInstrument.name}`,
      instrumentName: r.moneyIn ? t.toInstrument.name : t.fromInstrument.name,
      source: "TRANSFER",
      sameInstrument: true,
      confidence: "HIGH" as const,
      daysApart: days,
      reason: `already recorded as a transfer, ${days === 0 ? "the same day" : `${days} day${days === 1 ? "" : "s"} apart`}`,
    };
  };

  // The other side of a move between accounts, already recorded on the other
  // account as a transaction in a transfer category ("Transfer Out" on BofA
  // for this "Transfer In" on Wells Fargo): same amount and currency, the
  // other direction, within a few days. Not a duplicate -- this account
  // still needs its side -- but it shouldn't become a second, linked
  // transfer that moves the money out of the other account again.
  const sides = await prisma.transaction.findMany({
    where: {
      householdId: user.householdId,
      currency: instrument.currency,
      NOT: { instrumentId },
      date: {
        gte: new Date(Date.parse(`${dates[0]}T00:00:00Z`) - DUPLICATE_WINDOW_DAYS * 86_400_000),
        lt: new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + (DUPLICATE_WINDOW_DAYS + 1) * 86_400_000),
      },
    },
    select: { id: true, date: true, amount: true, instrumentId: true, instrument: { select: { name: true, type: true } }, category: { select: { name: true, direction: true, kind: true } } },
  });
  const transferSides = sides.filter((t) => kindOf(t.category) === "TRANSFER" && t.instrument.type !== "CREDIT_CARD");
  const usedSides = new Set<string>();
  const otherSides = rows.map((r) => {
    const t = transferSides.find(
      (x) =>
        !usedSides.has(x.id) &&
        Math.round(Number(x.amount) * 100) === Math.round(Math.abs(r.amount) * 100) &&
        (x.category.direction === "INCOME") === !r.moneyIn &&
        Math.abs(Date.parse(`${r.date}T00:00:00Z`) - x.date.getTime()) <= DUPLICATE_WINDOW_DAYS * 86_400_000
    );
    if (!t) return null;
    usedSides.add(t.id);
    return { instrumentId: t.instrumentId, instrumentName: t.instrument.name, categoryName: t.category.name, date: t.date.toISOString().slice(0, 10) };
  });

  const matches = found.map((m, i) => {
    if (!m) return transferMatch(rows[i]);
    const e = byId.get(m.id)!;
    return {
      ...describeExisting(e),
      sameInstrument: e.instrumentId === instrumentId,
      confidence: m.confidence,
      daysApart: m.daysApart,
      reason: m.reason,
    };
  });
  return NextResponse.json({ matches, otherSides });
}
