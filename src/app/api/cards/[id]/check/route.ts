import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { findCauses, isMatch } from "@/lib/balanceCheck";
import { cardCheckItems, cardCheckSince, cardsOwedOn } from "@/lib/cardCheckData";

// Check a credit card against the card's own balance: what the card's app or
// website says is owed as of a date, against what this app works out ("Owed
// now" on Credit cards). Every check is kept; when they differ the reply
// lists the likely reasons. There is no "use the card's figure": the way to
// restart a card from the issuer's number is to type in its statement.
const body = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  owed: z.number().min(-10_000_000).max(10_000_000), // negative: the card owes you
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter what the card says is owed, and the date." }, { status: 400 });
  const { asOfDate, owed } = parsed.data;

  const card = await prisma.paymentInstrument.findUnique({ where: { id } });
  if (!card || card.householdId !== user.householdId || card.type !== "CREDIT_CARD") return NextResponse.json({ error: "Not found." }, { status: 404 });
  // A day's leeway: the browser's "today" can be a day ahead of the household's zone.
  if (asOfDate > calendarDateInZone(new Date(Date.now() + 86_400_000))) return NextResponse.json({ error: "That date is in the future." }, { status: 400 });

  const appOwed = (await cardsOwedOn(user.householdId, asOfDate)).get(id);
  if (appOwed == null) return NextResponse.json({ error: "Set this card's statement closing day (Card settings) first, so the app can work out what's owed." }, { status: 400 });

  const diff = Math.round((owed - appOwed) * 100) / 100;
  const matched = isMatch(owed, appOwed);
  await prisma.balanceCheck.create({ data: { instrumentId: id, asOfDate: new Date(`${asOfDate}T00:00:00Z`), bankBalance: owed, appBalance: appOwed } });
  const since = cardCheckSince(asOfDate);
  const hints = matched ? [] : findCauses({ diff, items: await cardCheckItems(id, card.currency, since, asOfDate), since, asOf: asOfDate, card: true });
  return NextResponse.json({ asOfDate, bankBalance: owed, appBalance: appOwed, diff, matched, adjusted: false, hints });
}
