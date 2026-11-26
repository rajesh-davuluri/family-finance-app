import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { toApproxUsd } from "@/lib/fx";
import { loadCards } from "@/lib/cardData";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { loadForDuplicateCheck, pairKey, settledPairs } from "@/lib/duplicateData";
import { findPairs } from "@/lib/duplicates";
import { attentionItems } from "@/lib/attention";
import { countsAsSpending, kindOf } from "@/lib/categoryKind";
import { loadCheckStatuses } from "@/lib/balanceCheckData";
import { loadCardCheckStatuses } from "@/lib/cardCheckData";
import { loadCloseOverview } from "@/lib/periodCloseData";
import { loadPeople } from "@/lib/personalLoanData";
import { loadSubscriptions } from "@/lib/subscriptionData";
import { loadReturns } from "@/lib/returnsData";
import { loadRecentFees } from "@/lib/feesData";
import { FEE_ADVICE, feeAlertText, interestStreaks } from "@/lib/fees";
import { returnText } from "@/lib/returns";
import { alertText } from "@/lib/subscriptions";
import { money } from "@/lib/money";
import { REMIND_AFTER_DAYS, daysSince } from "@/lib/personalLoans";
import { loadCashPlanInputs } from "@/lib/cashPlanData";
import { DEFAULT_CUSHION_USD, cashPlan, daysBetween } from "@/lib/cashPlan";

// The dashboard's "Needs attention" strip.

const STALE_DAYS = 14; // no new transaction on an account for this long
const DORMANT_DAYS = 120; // ...but it was in use within this long (not a dormant account)
const DAY = 86_400_000;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const householdId = user.householdId;
  const today = calendarDateInZone();
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const yearBack = new Date(Date.UTC(ty, tm - 1 - 12, 1));

  const [cards, instruments, budgets, yearTxns, latest, dupTxns, settled] = await Promise.all([
    loadCards(householdId, today),
    prisma.paymentInstrument.findMany({ where: { householdId, archived: false } }),
    prisma.budget.findMany({ where: { householdId }, include: { category: true } }),
    // This month and the twelve before it, for each category's own marks.
    prisma.transaction.findMany({
      where: { householdId, date: { gte: yearBack }, category: { direction: "EXPENSE" } },
      select: { categoryId: true, amount: true, currency: true, date: true, category: { select: { name: true, direction: true, kind: true } } },
    }),
    prisma.transaction.groupBy({ by: ["instrumentId"], where: { householdId }, _max: { date: true } }),
    loadForDuplicateCheck(householdId, new Date(todayMs - 180 * DAY).toISOString().slice(0, 10), today),
    settledPairs(householdId),
  ]);

  // Bank money (USD accounts with a balance set) against USD card bills.
  let bankUsd: number | null = null;
  for (const b of instruments.filter((i) => i.type === "BANK_ACCOUNT" && i.currency === "USD" && i.openingBalance !== null && i.openingBalanceDate)) {
    bankUsd = (bankUsd ?? 0) + (await computeInstrumentBalance(b.id, Number(b.openingBalance), b.openingBalanceDate!));
  }
  // Only bills due before the next biweekly paycheck could leave the bank
  // short; later ones are paid from that paycheck.
  const cardBillsUsd = cards
    .filter((c) => c.currency === "USD" && c.snapshot.daysToDue != null && c.snapshot.daysToDue <= 14)
    .reduce((t, c) => t + c.snapshot.leftOnStatement, 0);

  // Each spending category by month: this month so far, last month, and the
  // average of the full months on record in the past year.
  const thisMonth = today.slice(0, 7);
  const lastMonth = new Date(Date.UTC(ty, tm - 2, 1)).toISOString().slice(0, 7);
  const byCategory = new Map<string, { name: string; months: Map<string, number> }>();
  let firstMonth = thisMonth;
  for (const t of yearTxns) {
    const day = t.date.toISOString().slice(0, 10);
    if (day > today) continue; // dated ahead: hasn't happened yet
    const month = day.slice(0, 7);
    if (month < firstMonth) firstMonth = month;
    const kind = kindOf(t.category);
    if (!countsAsSpending(kind) || kind === "REFUND") continue;
    const c = byCategory.get(t.categoryId) ?? { name: t.category.name, months: new Map<string, number>() };
    c.months.set(month, (c.months.get(month) ?? 0) + toApproxUsd(Number(t.amount), t.currency));
    byCategory.set(t.categoryId, c);
  }
  // Full months with records at all (a newer household has fewer than 12).
  const fullMonths = ty * 12 + tm - 1 - (Number(firstMonth.slice(0, 4)) * 12 + Number(firstMonth.slice(5, 7)) - 1);
  const limits = new Map(budgets.map((b) => [b.categoryId, Number(b.monthlyLimit)]));
  const categories = [...byCategory.entries()].map(([id, c]) => {
    const earlier = [...c.months.entries()].filter(([m]) => m < thisMonth).reduce((sum, [, v]) => sum + v, 0);
    return {
      name: c.name,
      spent: c.months.get(thisMonth) ?? 0,
      limit: limits.get(id) ?? null,
      lastMonth: fullMonths >= 1 ? (c.months.get(lastMonth) ?? 0) : null,
      // An average of one or two months is just those months again.
      average: fullMonths >= 3 ? earlier / fullMonths : null,
    };
  });

  const split = new Map(dupTxns.map((t) => [t.id, !!t.splitGroupId]));
  const likelyDuplicates = findPairs(dupTxns, (a, b) => settled.has(pairKey(a, b))).filter(
    (p) => p.confidence === "HIGH" && !(split.get(p.keep) && split.get(p.remove)) && !settled.has(pairKey(p.keep, p.remove)),
  ).length;

  const lastBy = new Map(latest.map((l) => [l.instrumentId, l._max.date]));
  const stale = instruments
    .filter((i) => i.type === "BANK_ACCOUNT" || i.type === "CREDIT_CARD")
    .map((i) => ({ name: i.name, last: lastBy.get(i.id) }))
    .filter((x): x is { name: string; last: Date } => !!x.last)
    .map((x) => ({ name: x.name, lastDate: x.last.toISOString().slice(0, 10), days: Math.round((todayMs - x.last.getTime()) / DAY) }))
    .filter((x) => x.days >= STALE_DAYS && x.days <= DORMANT_DAYS)
    .sort((a, b) => b.days - a.days);

  // Payday planner: the first day cash dips under the cushion.
  let plan: { ran: boolean; tight: { start: string; lowest: number; lowestDate: string; under: number; cause: string | null; actBy: string; actByDays: number; daysAway: number } | null } | undefined;
  if (bankUsd != null) {
    const [inputs, household] = await Promise.all([
      loadCashPlanInputs(householdId, today),
      prisma.household.findUnique({ where: { id: householdId }, select: { cashCushionUsd: true } }),
    ]);
    const cushionUsd = household?.cashCushionUsd != null ? Number(household.cashCushionUsd) : DEFAULT_CUSHION_USD;
    const p = cashPlan({ ...inputs, cushionUsd, days: inputs.windowDays });
    const first = p.tight[0];
    plan = {
      ran: true,
      tight: first
        ? { start: first.start, lowest: first.lowest, lowestDate: first.lowestDate, under: first.under, cause: first.causes[0]?.label ?? null, actBy: first.actBy, actByDays: daysBetween(today, first.actBy), daysAway: daysBetween(today, first.lowestDate) }
        : null,
    };
  }

  const banks = instruments.filter((i) => i.type === "BANK_ACCOUNT" && !i.archived);
  const [checkStatuses, cardChecks, closeOverview] = await Promise.all([loadCheckStatuses(banks), loadCardCheckStatuses(householdId), loadCloseOverview(householdId, today)]);
  const people = await loadPeople(householdId);
  // Subscription changes worth a look: not a price drop (good news).
  const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  // A failure here (the subscriptions table not migrated yet) mustn't take
  // down the rest of Needs attention.
  // Fees & interest: interest charged month after month on a card, and any
  // fee in the last two weeks not reversed -- the ones you can act on first.
  const fees = await loadRecentFees(householdId, today).catch(() => []);
  const twoWeeks = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const feeOrder = ["LATE_FEE", "OVERDRAFT", "RETURNED_PAYMENT", "INTEREST", "CASH_ADVANCE_FEE", "ANNUAL_FEE", "SERVICE_FEE", "FX_FEE", "ATM_FEE"];
  const streaks = interestStreaks(fees).filter((s) => s.latest === thisMonth || s.latest === lastMonth);
  const feeAlerts = [
    ...streaks.map((s) => `Interest charged on ${s.account} ${s.months} months in a row: ${FEE_ADVICE.INTEREST}`),
    ...fees
      .filter((f) => !f.waivedBy && f.date >= twoWeeks && !(f.feeKind === "INTEREST" && streaks.some((s) => s.account === f.instrumentName)))
      .sort((a, b) => feeOrder.indexOf(a.feeKind) - feeOrder.indexOf(b.feeKind) || b.date.localeCompare(a.date))
      .map((f) => feeAlertText(f, (n) => money(n, f.currency))),
  ];
  // Returns worth a look: a refund late or short (in the last 30 days), a
  // return window about to close.
  const recent = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const returnOrder = ["LATE", "SHORT", "WINDOW_SOON"];
  const returnAlerts = (await loadReturns(householdId, today).catch(() => ({ items: [] as Awaited<ReturnType<typeof loadReturns>>["items"] }))).items
    .filter((i) => i.status && (i.status.kind === "LATE" || i.status.kind === "WINDOW_SOON" || (i.status.kind === "SHORT" && i.status.on >= recent)))
    .sort((a, b) => returnOrder.indexOf(a.status!.kind) - returnOrder.indexOf(b.status!.kind))
    .map((i) => returnText(i.name, i.status!, (n) => money(n, i.currency)));
  const subscriptionAlerts = (await loadSubscriptions(householdId, today).catch(() => []))
    .flatMap((s) => s.alerts.filter((a) => a.kind !== "PRICE_DOWN").map((a) => ({ s, a })))
    .sort((x, y) => ["CHARGED_AFTER_CANCEL", "DOUBLE", "PRICE_UP", "NEW"].indexOf(x.a.kind) - ["CHARGED_AFTER_CANCEL", "DOUBLE", "PRICE_UP", "NEW"].indexOf(y.a.kind))
    .map(({ s, a }) => alertText(s, a, (n) => money(n, s.currency), short));
  const owedToYou = people
    .filter((p) => p.balanceUsd >= 1 && p.since && daysSince(p.since, today) >= REMIND_AFTER_DAYS)
    .map((p) => ({ name: p.name, amountUsd: p.balanceUsd, since: p.since!, days: daysSince(p.since!, today) }));
  const closes = closeOverview.accounts.map((a) => ({ name: a.name, currency: a.currency, status: a.status, dueLabel: a.dueLabel, closedThrough: a.latest?.periodEnd ?? null, offNow: a.latest?.offNow ?? 0 }));
  const checks = [
    ...banks.flatMap((b) => {
      const c = checkStatuses.get(b.id);
      return c ? [{ name: b.name, currency: b.currency, asOfDate: c.asOfDate, diff: c.diff, matched: c.matched, daysSince: c.daysSince, likely: c.likely }] : [];
    }),
    ...cards.flatMap((k) => {
      const c = cardChecks.get(k.id);
      return c ? [{ name: k.name, currency: k.currency, asOfDate: c.asOfDate, diff: c.diff, matched: c.matched, daysSince: c.daysSince, card: true, likely: c.likely }] : [];
    }),
  ];

  const items = attentionItems({
    cards: cards.map((c) => ({ name: c.name, currency: c.currency, leftOnStatement: c.snapshot.leftOnStatement, daysToDue: c.snapshot.daysToDue })),
    categories,
    bankUsd,
    cardBillsUsd,
    likelyDuplicates,
    stale,
    cashPlan: plan,
    checks,
    closes,
    owedToYou,
    subscriptionAlerts,
    returnAlerts,
    feeAlerts,
  });
  return NextResponse.json({ items });
}
