import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { debtToApproxUsd, convertToDebtCurrency } from "@/lib/debtCalculations";

function monthLabel(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [instruments, debts] = await Promise.all([
    prisma.paymentInstrument.findMany({ where: { householdId: user.householdId, archived: false } }),
    prisma.debt.findMany({
      where: { householdId: user.householdId, status: "ACTIVE" },
      include: { payments: true },
    }),
  ]);

  const trackedInstruments = instruments.filter((i) => i.openingBalance !== null && i.openingBalanceDate !== null);

  // --- Current snapshot ---
  const currentInstrumentBalances = await Promise.all(
    trackedInstruments.map((i) => computeInstrumentBalance(i.id, Number(i.openingBalance), i.openingBalanceDate!))
  );
  const assetsUsd = trackedInstruments.reduce(
    (sum, i, idx) => sum + toApproxUsd(currentInstrumentBalances[idx], i.currency),
    0
  );

  const debtInfo = (d: (typeof debts)[number]) => ({
    currency: d.currency,
    conversionRateToUsd: d.conversionRateToUsd ? Number(d.conversionRateToUsd) : null,
  });
  const currentDebtBalance = (d: (typeof debts)[number]) => {
    const paid = d.payments.reduce((sum, p) => sum + convertToDebtCurrency(Number(p.amount), p.currency, debtInfo(d)), 0);
    return Number(d.originalPrincipal) - paid;
  };
  const liabilitiesUsd = debts.reduce((sum, d) => sum + debtToApproxUsd(currentDebtBalance(d), d.currency, debtInfo(d).conversionRateToUsd), 0);

  // --- 6-month trend (end of each of the last 6 months, including now) ---
  const now = new Date();
  const trend: { month: string; assets: number; liabilities: number; netWorth: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const pointDate = i === 0 ? now : new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // last day of that month, or today for the current month

    const instrumentBalancesAt = await Promise.all(
      trackedInstruments.map((inst) => computeInstrumentBalance(inst.id, Number(inst.openingBalance), inst.openingBalanceDate!, pointDate))
    );
    const assetsAt = trackedInstruments.reduce((sum, inst, idx) => sum + toApproxUsd(instrumentBalancesAt[idx], inst.currency), 0);

    const liabilitiesAt = debts.reduce((sum, d) => {
      const paidByThen = d.payments
        .filter((p) => p.paymentDate <= pointDate)
        .reduce((s, p) => s + convertToDebtCurrency(Number(p.amount), p.currency, debtInfo(d)), 0);
      const balanceAt = Number(d.originalPrincipal) - paidByThen;
      return sum + debtToApproxUsd(balanceAt, d.currency, debtInfo(d).conversionRateToUsd);
    }, 0);

    trend.push({
      month: monthLabel(pointDate),
      assets: Math.round(assetsAt * 100) / 100,
      liabilities: Math.round(liabilitiesAt * 100) / 100,
      netWorth: Math.round((assetsAt - liabilitiesAt) * 100) / 100,
    });
  }

  return NextResponse.json({
    assets: Math.round(assetsUsd * 100) / 100,
    liabilities: Math.round(liabilitiesUsd * 100) / 100,
    netWorth: Math.round((assetsUsd - liabilitiesUsd) * 100) / 100,
    untrackedInstrumentCount: instruments.length - trackedInstruments.length,
    trend,
  });
}
