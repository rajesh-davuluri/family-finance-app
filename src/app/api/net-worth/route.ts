import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { debtToApproxUsd, convertToDebtCurrency } from "@/lib/debtCalculations";
import { currentFx, holdingInputs, householdAccounts } from "@/lib/investmentData";
import { analyze, costHeldAt, toUsd } from "@/lib/investments";
import { loadCards } from "@/lib/cardData";
import { calendarDateInZone } from "@/lib/appTimezone";

function monthLabel(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [instruments, debts, investmentAccounts, fx] = await Promise.all([
    prisma.paymentInstrument.findMany({ where: { householdId: user.householdId, archived: false } }),
    prisma.debt.findMany({
      where: { householdId: user.householdId, status: "ACTIVE" },
      include: { payments: true },
    }),
    householdAccounts(user.householdId),
    currentFx(),
  ]);

  // Investments: today at market value; past months at what had been paid
  // for what was held then (there are no past prices).
  const holdings = holdingInputs(investmentAccounts);
  const today = new Date().toISOString().slice(0, 10);
  const investmentsUsd = holdings.length ? analyze(holdings, fx, today).totals.valueUsd : 0;
  const investmentsCostAt = (d: Date) =>
    holdings.reduce((sum, h) => sum + toUsd(costHeldAt(h.trades, d.toISOString().slice(0, 10)), h.currency, fx), 0);

  // Bank and cash balances. Credit cards are counted as what they owe, from
  // their statements (below), not from an opening balance.
  const trackedInstruments = instruments.filter((i) => i.type !== "CREDIT_CARD" && i.openingBalance !== null && i.openingBalanceDate !== null);

  // --- Current snapshot ---
  const currentInstrumentBalances = await Promise.all(
    trackedInstruments.map((i) => computeInstrumentBalance(i.id, Number(i.openingBalance), i.openingBalanceDate!))
  );
  const cashUsd = trackedInstruments.reduce(
    (sum, i, idx) => sum + toApproxUsd(currentInstrumentBalances[idx], i.currency),
    0
  );
  const assetsUsd = cashUsd + investmentsUsd;

  const debtInfo = (d: (typeof debts)[number]) => ({
    currency: d.currency,
    conversionRateToUsd: d.conversionRateToUsd ? Number(d.conversionRateToUsd) : null,
  });
  const currentDebtBalance = (d: (typeof debts)[number]) => {
    const paid = d.payments.reduce((sum, p) => sum + convertToDebtCurrency(Number(p.amount), p.currency, debtInfo(d)), 0);
    return Number(d.originalPrincipal) - paid;
  };
  const loansUsd = debts.reduce((sum, d) => sum + debtToApproxUsd(currentDebtBalance(d), d.currency, debtInfo(d).conversionRateToUsd), 0);
  // What's owed on credit cards right now (Credit cards page); a card in
  // credit counts as nothing owed.
  const cards = await loadCards(user.householdId, calendarDateInZone());
  const cardsOwedUsd = cards.reduce((sum, c) => sum + toApproxUsd(Math.max(0, c.snapshot.outstanding ?? 0), c.currency), 0);
  const liabilitiesUsd = loansUsd + cardsOwedUsd;

  // --- 6-month trend (end of each of the last 6 months, including now) ---
  const now = new Date();
  const trend: { month: string; assets: number; liabilities: number; netWorth: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const pointDate = i === 0 ? now : new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // last day of that month, or today for the current month

    const instrumentBalancesAt = await Promise.all(
      trackedInstruments.map((inst) => computeInstrumentBalance(inst.id, Number(inst.openingBalance), inst.openingBalanceDate!, pointDate))
    );
    const assetsAt =
      trackedInstruments.reduce((sum, inst, idx) => sum + toApproxUsd(instrumentBalancesAt[idx], inst.currency), 0) +
      (i === 0 ? investmentsUsd : investmentsCostAt(pointDate));

    const liabilitiesAt = debts.reduce((sum, d) => {
      const paidByThen = d.payments
        .filter((p) => p.paymentDate <= pointDate)
        .reduce((s, p) => s + convertToDebtCurrency(Number(p.amount), p.currency, debtInfo(d)), 0);
      const balanceAt = Number(d.originalPrincipal) - paidByThen;
      return sum + debtToApproxUsd(balanceAt, d.currency, debtInfo(d).conversionRateToUsd);
    }, 0) + (i === 0 ? cardsOwedUsd : 0); // card balances are known only for now

    trend.push({
      month: monthLabel(pointDate),
      assets: Math.round(assetsAt * 100) / 100,
      liabilities: Math.round(liabilitiesAt * 100) / 100,
      netWorth: Math.round((assetsAt - liabilitiesAt) * 100) / 100,
    });
  }

  return NextResponse.json({
    assets: Math.round(assetsUsd * 100) / 100,
    cash: Math.round(cashUsd * 100) / 100,
    investments: Math.round(investmentsUsd * 100) / 100,
    liabilities: Math.round(liabilitiesUsd * 100) / 100,
    cardsOwed: Math.round(cardsOwedUsd * 100) / 100,
    netWorth: Math.round((assetsUsd - liabilitiesUsd) * 100) / 100,
    untrackedInstrumentCount: instruments.filter((i) => i.type !== "CREDIT_CARD").length - trackedInstruments.length,
    trend,
  });
}
