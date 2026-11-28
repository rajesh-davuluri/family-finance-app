import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { isMatch } from "@/lib/balanceCheck";
import { addDays } from "@/lib/cards";
import { adjustmentFor, withinTolerance } from "@/lib/periodClose";
import { adjustmentCategoryId, appFigureOn, closeCauses, closeTransit, diffUsd, kindOfAccount, toleranceUsd, unavailableReason } from "@/lib/periodCloseData";
import { cardsOwedOn } from "@/lib/cardCheckData";

// Close an account through a date. The bank's balance (or what the card
// says is owed) is checked against the app's figure for that date:
//   - they match: the period is closed;
//   - they differ: the likely causes come back, and nothing is closed;
//   - they differ and `accept` is set: the difference is recorded as a
//     balance adjustment on the account and the period is closed. Above the
//     household's tolerance a note saying why is required.
// Every attempt is also kept as a balance check.
const body = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  figure: z.number().min(-100_000_000).max(100_000_000),
  accept: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the figure and the date it's for." }, { status: 400 });
  const { asOfDate, figure, accept, note } = parsed.data;

  const inst = await prisma.paymentInstrument.findUnique({ where: { id } });
  if (!inst || inst.householdId !== user.householdId || !["BANK_ACCOUNT", "CREDIT_CARD"].includes(inst.type)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const kind = kindOfAccount(inst);
  // A day's leeway: the browser's "today" can be a day ahead of the household's zone.
  if (asOfDate > calendarDateInZone(new Date(Date.now() + 86_400_000))) return NextResponse.json({ error: "That date is in the future." }, { status: 400 });

  const latest = await prisma.periodClose.findFirst({ where: { instrumentId: id }, orderBy: { periodEnd: "desc" } });
  const latestEnd = latest ? latest.periodEnd.toISOString().slice(0, 10) : null;
  if (latestEnd && asOfDate <= latestEnd) {
    return NextResponse.json({ error: `Already closed through ${latestEnd}. Pick a later date, or undo that close first.` }, { status: 400 });
  }

  const owed = kind === "CARD" ? await cardsOwedOn(user.householdId, asOfDate) : undefined;
  const app = await appFigureOn(user.householdId, inst, asOfDate, owed);
  if (app == null) {
    const why =
      unavailableReason(inst, owed?.get(id) != null) ??
      `Pick a date on or after ${inst.openingBalanceDate?.toISOString().slice(0, 10)}, when this account's starting balance was set.`;
    return NextResponse.json({ error: why }, { status: 400 });
  }

  const diff = r2(figure - app);
  const matched = isMatch(figure, app);
  const tolerance = await toleranceUsd(user.householdId);
  const within = withinTolerance(diffUsd(diff, inst.currency), tolerance);
  const asOf = new Date(`${asOfDate}T00:00:00Z`);
  const base = { asOfDate, figure, app, diff, toleranceUsd: tolerance, within };

  // Keep the check either way, so the account's ✓ / ⚠ elsewhere follows it.
  await prisma.balanceCheck.create({ data: { instrumentId: id, asOfDate: asOf, bankBalance: figure, appBalance: app } });

  const closer = { closedById: user.id, closedByName: user.name || user.email || "Someone" };
  if (matched) {
    await prisma.periodClose.create({ data: { instrumentId: id, periodEnd: asOf, statementFigure: figure, appFigure: app, note: note || null, ...closer } });
    return NextResponse.json({ ...base, status: "CLOSED", adjustment: 0 });
  }

  // Only entries made just before the date that posted after it: closed as
  // matched, the gap noted, no adjustment -- they'll post.
  const transit = await closeTransit(inst, asOfDate, diff, latestEnd ? addDays(latestEnd, 1) : null);
  if (transit) {
    await prisma.periodClose.create({
      data: { instrumentId: id, periodEnd: asOf, statementFigure: figure, appFigure: app, adjustment: diff, note: [note, transit].filter(Boolean).join(" · "), ...closer },
    });
    return NextResponse.json({ ...base, status: "CLOSED", adjustment: 0, inTransit: transit });
  }

  if (!accept) {
    const hints = await closeCauses(inst, asOfDate, diff, latestEnd ? addDays(latestEnd, 1) : null);
    return NextResponse.json({ ...base, status: "OFF", hints });
  }
  if (!within && !note) {
    return NextResponse.json({ error: `That's more than your $${tolerance} tolerance: add a note saying why it's being accepted.` }, { status: 400 });
  }

  const adj = adjustmentFor(kind, diff);
  const categoryId = await adjustmentCategoryId(user.householdId, adj.direction);
  await prisma.$transaction(async (tx) => {
    const txn = await tx.transaction.create({
      data: {
        amount: adj.amount,
        currency: inst.currency,
        date: asOf,
        notes: `Balance adjustment · closing through ${asOfDate}${note ? ` · ${note}` : ""}`,
        householdId: user.householdId,
        categoryId,
        instrumentId: id,
        createdById: user.id,
        source: "ADJUSTMENT",
      },
    });
    await tx.periodClose.create({
      data: { instrumentId: id, periodEnd: asOf, statementFigure: figure, appFigure: app, adjustment: diff, adjustmentTransactionId: txn.id, note: note || null, ...closer },
    });
  });
  return NextResponse.json({ ...base, status: "CLOSED", adjustment: diff });
}
