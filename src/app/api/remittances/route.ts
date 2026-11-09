import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { kindOf } from "@/lib/categoryKind";
import { rateOn, usdInrHistory } from "@/lib/prices";
import { isRemittance, serviceOf, summarize, viewTransfer } from "@/lib/remittances";

// Money sent to India in a year: each transfer with the rupees received
// (typed in), the rate got, the market rate that day, and what the
// difference cost.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const today = calendarDateInZone();
  const year = Number(new URL(req.url).searchParams.get("year")) || Number(today.slice(0, 4));

  const txns = await prisma.transaction.findMany({
    where: { householdId: user.householdId, currency: "USD", category: { direction: "EXPENSE" } },
    select: {
      id: true,
      date: true,
      amount: true,
      currency: true,
      notes: true,
      category: { select: { name: true, direction: true, kind: true } },
      remittance: { select: { inrReceived: true, feeUsd: true } },
    },
    orderBy: { date: "desc" },
  });
  const all = txns.filter((t) => isRemittance({ categoryName: t.category.name, categoryKind: kindOf(t.category), notes: t.notes, currency: t.currency }));
  const years = Array.from(new Set([Number(today.slice(0, 4)), ...all.map((t) => t.date.getUTCFullYear())])).sort((a, b) => b - a);
  const inYear = all.filter((t) => t.date.getUTCFullYear() === year);

  const rates = inYear.length ? await usdInrHistory() : null;
  const rows = inYear.map((t) => {
    const date = t.date.toISOString().slice(0, 10);
    return viewTransfer({
      id: t.id,
      date,
      usd: Number(t.amount),
      service: serviceOf(t.notes),
      notes: t.notes,
      inrReceived: t.remittance ? Number(t.remittance.inrReceived) : null,
      feeUsd: t.remittance?.feeUsd != null ? Number(t.remittance.feeUsd) : null,
      marketRate: rates ? rateOn(rates, date) : null,
    });
  });
  const latestRate = rates ? rateOn(rates, today) : null;

  return NextResponse.json({ year, years, today, marketAvailable: !!rates, latestRate, transfers: rows, summary: summarize(rows) });
}
