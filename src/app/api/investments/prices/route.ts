import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { fetchPrices } from "@/lib/prices";

// Refreshes the price of every holding that can be looked up (NSE, BSE, US,
// crypto, Indian mutual funds) and the USD/INR rate. Typed-in prices for
// holdings that can't be looked up are left alone.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const holdings = await prisma.holding.findMany({
    where: { account: { householdId: user.householdId, archived: false }, exchange: { not: "OTHER" } },
    select: { id: true, symbol: true, exchange: true, currency: true },
  });
  const { prices, failed, usdInr } = await fetchPrices(holdings);

  const now = new Date();
  await prisma.$transaction([
    ...[...prices.entries()].map(([id, price]) =>
      prisma.holding.update({ where: { id }, data: { lastPrice: price, lastPriceAt: now, priceSource: "LIVE" } }),
    ),
    ...(usdInr
      ? [prisma.marketRate.upsert({ where: { pair: "USDINR" }, create: { pair: "USDINR", rate: usdInr }, update: { rate: usdInr } })]
      : []),
  ]);
  return NextResponse.json({ updated: prices.size, failed, usdInr });
}
