import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { accountOf, holdingFields, tradeData } from "@/lib/investmentData";

// Adds a holding, usually with its first buy.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = holdingFields.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  const account = await accountOf(d.accountId, user.householdId);
  if (!account) return NextResponse.json({ error: "Pick an account." }, { status: 400 });

  const symbol = d.symbol.trim().toUpperCase();
  const existing = await prisma.holding.findFirst({ where: { accountId: account.id, symbol, exchange: d.exchange } });
  if (existing) return NextResponse.json({ error: `${symbol} is already in ${account.name}. Add a buy to it instead.` }, { status: 409 });

  const holding = await prisma.holding.create({
    data: {
      accountId: account.id,
      symbol,
      name: d.name || null,
      exchange: d.exchange,
      assetType: d.assetType,
      sector: d.sector || null,
      currency: d.currency ?? account.currency,
      notes: d.notes || null,
      ...(d.price ? { lastPrice: d.price, lastPriceAt: new Date(), priceSource: "MANUAL" } : {}),
      ...(d.firstTrade ? { trades: { create: tradeData(d.firstTrade) } } : {}),
    },
  });
  return NextResponse.json(holding, { status: 201 });
}
