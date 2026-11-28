import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { balanceItems, computeInstrumentBalance } from "@/lib/balanceCalculations";
import { findCauses, inTransit, isMatch, transitText } from "@/lib/balanceCheck";
import { money } from "@/lib/money";

// Check an account against the bank: the balance the bank shows as of a
// date, against what the app works out for that date. Every check is kept.
// When they differ the reply lists the likely reasons; `useBankFigure` then
// takes the bank's number as the account's new starting balance (from the
// next day), for a difference that can't be found.
const body = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bankBalance: z.number().min(-100_000_000).max(100_000_000),
  useBankFigure: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the bank's balance and its date." }, { status: 400 });
  const { asOfDate, bankBalance, useBankFigure } = parsed.data;

  const instrument = await prisma.paymentInstrument.findUnique({ where: { id } });
  if (!instrument || instrument.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (instrument.type === "CREDIT_CARD") return NextResponse.json({ error: "Cards are checked against their statements on the Credit cards page." }, { status: 400 });
  if (instrument.openingBalance === null || !instrument.openingBalanceDate) return NextResponse.json({ error: "Set a starting balance on this account first." }, { status: 400 });

  const since = instrument.openingBalanceDate.toISOString().slice(0, 10);
  if (asOfDate < since) return NextResponse.json({ error: `Pick a date on or after ${since}, when this account's starting balance was set.` }, { status: 400 });
  // A day's leeway: the browser's "today" can be a day ahead of the
  // household's time zone.
  if (asOfDate > calendarDateInZone(new Date(Date.now() + 86_400_000))) return NextResponse.json({ error: "That date is in the future." }, { status: 400 });

  const asOf = new Date(`${asOfDate}T00:00:00Z`);
  const appBalance = await computeInstrumentBalance(id, Number(instrument.openingBalance), instrument.openingBalanceDate, asOf);
  const diff = Math.round((bankBalance - appBalance) * 100) / 100;
  const matched = isMatch(bankBalance, appBalance);
  const adjusted = !!useBankFigure && !matched;

  if (adjusted) {
    // From the next day on, the balance builds on the bank's figure.
    await prisma.$transaction([
      prisma.balanceCheck.create({ data: { instrumentId: id, asOfDate: asOf, bankBalance, appBalance, adjusted: true } }),
      prisma.paymentInstrument.update({ where: { id }, data: { openingBalance: bankBalance, openingBalanceDate: new Date(asOf.getTime() + 86_400_000) } }),
    ]);
    return NextResponse.json({ asOfDate, bankBalance, appBalance, diff, matched: true, adjusted: true, hints: [] });
  }

  await prisma.balanceCheck.create({ data: { instrumentId: id, asOfDate: asOf, bankBalance, appBalance } });
  const items = matched ? [] : await balanceItems(id, instrument.openingBalanceDate);
  // Entries made just before the date that the bank cleared after it: a match.
  const transit = matched ? null : inTransit({ diff, items: items.filter((i) => i.date >= since), asOf: asOfDate });
  if (transit) return NextResponse.json({ asOfDate, bankBalance, appBalance, diff, matched: true, adjusted: false, hints: [], inTransit: transitText(transit, (n) => money(n, instrument.currency)) });
  const hints = matched ? [] : findCauses({ diff, items, since, asOf: asOfDate });
  return NextResponse.json({ asOfDate, bankBalance, appBalance, diff, matched, adjusted: false, hints });
}
