import { prisma } from "@/lib/prisma";
import { toApproxUsd } from "@/lib/fx";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { countsAsSpending, flowOf, kindOf } from "@/lib/categoryKind";
import { Payday, biweeklyPaydays, buildCycles, expectedPaydays, isSalary } from "@/lib/payCycles";
import { detectHouseholdRecurring } from "@/lib/recurringData";
import { loadCards } from "@/lib/cardData";
import { CashEvent, addDays, occurrences } from "@/lib/cashPlan";
import { upcoming } from "@/lib/yearAhead";
import { loadPlannedItems } from "@/lib/yearAheadData";

// Gathers what the payday planner needs (src/lib/cashPlan.ts):
//   cash      US bank accounts with a balance set, not an "Emergency..." one
//   paychecks every 14 days from the last salary, at the usual amount
//   bills     recurring templates and bills found in history, paid from a bank
//   cards     each card's statement left to pay, and the next statement
//             (charges so far plus the usual daily card spending to closing)
//   loans     debts with a fixed instalment, unless already a bill above
//   everyday  debit card / Zelle spending from the banks, per day (90 days,
//             leaving out one-offs over $500)
//   planned   the Year ahead page's big costs due in the window, and the
//             money set aside for them

const WINDOW = 30;
const HISTORY = 90;
// A bigger one-off (a $5,000 transfer logged as Misc) isn't a daily habit;
// planned big spends are what the "what if I spend" box is for.
const ONE_OFF_USD = 500;
const EMERGENCY_ACCOUNT = /emergency/i;
const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (amount: number, currency: string) => r2(toApproxUsd(amount, currency));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthDay = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

export async function loadCashPlanInputs(householdId: string, today: string) {
  const end = addDays(today, WINDOW - 1);
  const histFrom = new Date(Date.parse(`${today}T00:00:00Z`) - HISTORY * DAY);

  const [instruments, incomeRows, templates, recent, cards, debts, recurring, planned, household] = await Promise.all([
    prisma.paymentInstrument.findMany({ where: { householdId, archived: false } }),
    prisma.transaction.findMany({
      where: { householdId, category: { direction: "INCOME" } },
      select: { id: true, date: true, amount: true, currency: true, category: { select: { name: true, direction: true, kind: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.recurringTemplate.findMany({
      where: { householdId, active: true, instrument: { archived: false } },
      include: { category: { select: { name: true, direction: true, kind: true } }, instrument: { select: { id: true, type: true, name: true } } },
    }),
    prisma.transaction.findMany({
      where: { householdId, date: { gte: histFrom } },
      select: { date: true, amount: true, currency: true, instrumentId: true, instrument: { select: { type: true, name: true } }, category: { select: { name: true, direction: true, kind: true } } },
    }),
    loadCards(householdId, today),
    prisma.debt.findMany({ where: { householdId, status: "ACTIVE", installmentAmount: { not: null } }, include: { payments: { orderBy: { paymentDate: "desc" }, take: 1 } } }),
    detectHouseholdRecurring(householdId, today),
    loadPlannedItems(householdId),
    prisma.household.findUnique({ where: { id: householdId }, select: { yearAheadSetAsideUsd: true } }),
  ]);

  // Cash in the US banks.
  const banks = instruments.filter((i) => i.type === "BANK_ACCOUNT");
  const bankNames = new Set(banks.map((b) => b.name));
  const accounts: { name: string; usd: number | null; counted: boolean; note?: string }[] = [];
  let cashUsd = 0;
  const countedIds = new Set<string>(); // banks whose cash is counted
  for (const b of banks) {
    const known = b.openingBalance !== null && b.openingBalanceDate !== null;
    const bal = known ? await computeInstrumentBalance(b.id, Number(b.openingBalance), b.openingBalanceDate!) : null;
    const counted = bal !== null && b.currency === "USD" && !EMERGENCY_ACCOUNT.test(b.name);
    if (counted) {
      cashUsd += bal!;
      countedIds.add(b.id);
    }
    accounts.push({
      name: b.name,
      usd: bal === null ? null : usd(bal, b.currency),
      counted,
      note: bal === null ? "no balance set" : b.currency !== "USD" ? "not in US dollars" : EMERGENCY_ACCOUNT.test(b.name) ? "emergency fund" : undefined,
    });
  }

  const events: CashEvent[] = [];

  // Paychecks: every 14 days from the last one, at the usual recent amount.
  const salaries: Payday[] = incomeRows
    .filter((t) => isSalary(kindOf(t.category), t.category.name))
    .map((t) => ({ date: t.date.toISOString().slice(0, 10), amount: Number(t.amount), currency: t.currency, usd: usd(Number(t.amount), t.currency), transactionId: t.id }));
  let nextPayday: string | null = null;
  let paycheckUsd: number | null = null;
  if (salaries.length) {
    const { paydays } = biweeklyPaydays(salaries);
    const cycles = buildCycles(paydays);
    const last = cycles[cycles.length - 1];
    paycheckUsd = r2(median(paydays.slice(-3).map((p) => p.usd)));
    for (const p of expectedPaydays(last.start, 4)) {
      const date = p.likelyDate ?? p.date;
      // A late paycheck is expected any day now.
      const when = date <= today ? addDays(today, 1) : date;
      if (when > end) break;
      nextPayday ??= when;
      events.push({ key: `pay:${p.date}`, date: when, label: "Paycheck", sub: p.holiday ? `${p.holiday}: likely early` : date <= today ? "late — expected any day" : "expected", kind: "PAYCHECK", usd: paycheckUsd, estimated: true });
    }
  }

  // Bills from recurring templates, paid from a bank.
  const templateCategories = new Set<string>();
  for (const t of templates) {
    const kind = kindOf(t.category);
    if (t.instrument.type !== "BANK_ACCOUNT" || !countsAsSpending(kind) || kind === "REFUND") continue;
    templateCategories.add(t.category.name);
    const next = t.nextRunAt.toISOString().slice(0, 10);
    const interval = t.frequency === "WEEKLY" ? 7 : t.frequency === "YEARLY" ? 365 : 30;
    for (const date of occurrences(next < today ? today : next, t.frequency, interval, today, end)) {
      events.push({ key: `tpl:${t.id}:${date}`, date, label: t.notes || t.category.name, sub: `recurring · ${t.instrument.name}`, kind: kind === "DEBT_PAYMENT" ? "LOAN" : "BILL", usd: usd(Number(t.amount), t.currency) });
    }
  }

  // Bills found in history (rent, EMIs, phone...), paid from a bank. Card-paid
  // ones reach the bank through the card bill instead.
  const loanAmounts: number[] = [];
  for (const b of recurring.bills) {
    if (!bankNames.has(b.instrumentName) || templateCategories.has(b.categoryName)) continue;
    if (!countsAsSpending(b.kind) || b.kind === "REFUND") continue;
    let next = b.nextDate;
    if (b.status === "STOPPED") {
      // Rent or an EMI paid under a new name still counts: a payment of about
      // the same size in its category, from the same bank, in the last 45 days.
      if (b.kind !== "BILL" && b.kind !== "DEBT_PAYMENT") continue;
      const since = addDays(today, -45);
      const latest = recent
        .filter((t) => t.category.name === b.categoryName && t.instrument.name === b.instrumentName && Math.abs(usd(Number(t.amount), t.currency) - b.usd) <= b.usd * 0.25)
        .map((t) => t.date.toISOString().slice(0, 10))
        .filter((d) => d >= since)
        .sort()
        .pop();
      if (!latest) continue;
      next = occurrences(latest, b.frequency, b.intervalDays, addDays(latest, 1), addDays(latest, 400))[0];
      if (!next) continue;
    }
    if (b.kind === "DEBT_PAYMENT") loanAmounts.push(b.usd);
    // A payment a few days late is still expected.
    if (next < today && next >= addDays(today, -7)) next = today;
    for (const date of occurrences(next, b.frequency, b.intervalDays, today, end)) {
      events.push({ key: `bill:${b.key}:${date}`, date, label: b.label, sub: `usual · ${b.instrumentName}`, kind: b.kind === "DEBT_PAYMENT" ? "LOAN" : "BILL", usd: b.usd, estimated: true });
    }
  }

  // Loans with a fixed instalment that aren't already a bill above.
  for (const d of debts) {
    const amt = usd(Number(d.installmentAmount), d.currency);
    if (loanAmounts.some((x) => Math.abs(x - amt) <= Math.max(5, amt * 0.1))) continue;
    const step = d.installmentFrequency === "WEEKLY" ? 7 : d.installmentFrequency === "BIWEEKLY" ? 14 : 30;
    const lastPaid = d.payments[0]?.paymentDate.toISOString().slice(0, 10) ?? d.startDate.toISOString().slice(0, 10);
    // Stepping on from the last payment (or the start), within the window.
    for (const date of occurrences(lastPaid, d.installmentFrequency ?? "MONTHLY", step, today > lastPaid ? today : addDays(lastPaid, 1), end)) {
      events.push({ key: `debt:${d.id}:${date}`, date, label: d.name, sub: "loan instalment", kind: "LOAN", usd: amt });
    }
  }

  // Spending in the last 90 days: on the banks (everyday only) and per card.
  let bankEveryday = 0;
  const cardSpend = new Map<string, number>();
  for (const t of recent) {
    const kind = kindOf(t.category);
    if (!countsAsSpending(kind)) continue;
    const s = flowOf(kind, toApproxUsd(Number(t.amount), t.currency)).spending;
    if (t.instrument.type === "BANK_ACCOUNT") {
      // Only from the banks counted as cash, in dollars.
      if (countedIds.has(t.instrumentId) && t.currency === "USD" && (kind === "SPENDING" || kind === "REFUND") && Math.abs(s) <= ONE_OFF_USD) bankEveryday += s;
    } else if (t.instrument.type === "CREDIT_CARD") cardSpend.set(t.instrumentId, (cardSpend.get(t.instrumentId) ?? 0) + s);
  }
  const everydayDailyUsd = r2(Math.max(0, bankEveryday) / HISTORY);

  // Credit card bills.
  for (const c of cards) {
    const s = c.snapshot;
    if (c.currency !== "USD" || !s.hasCycle) continue;
    if (s.statement && s.leftOnStatement > 0.005) {
      events.push({
        key: `card:${c.id}:${s.statement.dueDate}`,
        date: s.statement.dueDate,
        label: `${c.name} bill`,
        sub: s.statement.basis === "RECORDED" ? "statement" : "statement (estimated)",
        kind: "CARD",
        usd: r2(s.leftOnStatement),
        minimumUsd: s.minimumLeft,
        estimated: s.statement.basis !== "RECORDED",
      });
    }
    // The statement still open: charges so far, plus the usual until it closes.
    if (s.nextClose && s.nextDue && s.nextDue <= end && s.nextDue !== s.statement?.dueDate) {
      const daily = (cardSpend.get(c.id) ?? 0) / HISTORY;
      const toClose = Math.max(0, Math.round((Date.parse(`${s.nextClose}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY));
      const amount = r2(Math.max(0, s.chargesSinceStatement - s.creditsSinceStatement) + daily * toClose);
      if (amount > 0.005) {
        events.push({ key: `card:${c.id}:${s.nextDue}`, date: s.nextDue, label: `${c.name} next bill`, sub: `estimate · closes ${monthDay(s.nextClose)}`, kind: "CARD", usd: amount, minimumUsd: null, estimated: true });
      }
    }
  }

  // Planned expenses (Year ahead) due in the window. One added from a
  // recurring bill is already a bill above.
  const plannedDue: { date: string; usd: number }[] = [];
  for (const o of upcoming(planned, today, WINDOW - 1)) {
    const date = o.overdue ? today : o.date;
    plannedDue.push({ date, usd: o.usd });
    const source = planned.find((p) => p.id === o.itemId)?.sourceKey ?? "";
    if (source.startsWith("tpl:") || source.startsWith("bill:")) continue;
    events.push({ key: `plan:${o.key}`, date, label: o.name, sub: o.overdue ? "planned · overdue" : "planned · year ahead", kind: "BILL", usd: o.usd });
  }
  const setAsideUsd = household?.yearAheadSetAsideUsd != null ? Number(household.yearAheadSetAsideUsd) : 0;

  return { today, cashUsd: r2(cashUsd), accounts, events, nextPayday, paycheckUsd, everydayDailyUsd, windowDays: WINDOW, setAsideUsd, plannedDue };
}
