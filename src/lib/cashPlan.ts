// Payday planner and bill shock preview. Pure: the API route gathers the
// inputs (src/lib/cashPlanData.ts), this works out
//   - safe to spend until the next paycheck (bank cash less every bill, card
//     payment and loan instalment due before it, and less the money set aside
//     for the year ahead),
//   - the bank cash day by day for the next 30 days, with paychecks in and
//     bills, card payments and everyday debit spending out,
//   - the days that cash dips under a cushion, and what pushes it there,
//   - how a "what if I spend / save $X" changes all of that and the emergency
//     fund timeline.
// Money is approximate USD, dates are YYYY-MM-DD.

// Flag days the bank cash would dip under this, unless the household sets
// its own.
export const DEFAULT_CUSHION_USD = 500;

export type CashEventKind = "PAYCHECK" | "BILL" | "CARD" | "LOAN";

export type CashEvent = {
  key: string;
  date: string;
  label: string;
  sub?: string;
  kind: CashEventKind;
  usd: number; // money in (paycheck) or out (everything else), always positive
  minimumUsd?: number | null; // cards: the minimum payment, when known
  estimated?: boolean; // a guess (next card bill, a bill found in history)
};

export type PlanInput = {
  today: string;
  cashUsd: number; // US bank accounts, not the emergency fund
  events: CashEvent[];
  nextPayday: string | null;
  everydayDailyUsd: number; // debit card / Zelle spending, per day
  cushionUsd: number;
  days?: number; // window, default 30
  cardsMinimumOnly?: boolean; // pay only the card minimums
  spendNowUsd?: number; // what if I spend $X now
  savePerPaydayUsd?: number; // what if I move $X to savings now and each payday
  // Year ahead (src/lib/yearAhead.ts): money in the bank that's already set
  // aside for the big irregular costs, and when those fall due.
  setAsideUsd?: number;
  plannedDue?: { date: string; usd: number }[];
};

export type PlanDay = { date: string; balance: number; events: (CashEvent & { paid: number })[]; everyday: number };
export type TightSpell = {
  start: string; // first day under the cushion
  end: string;
  lowest: number;
  lowestDate: string;
  under: number; // how far under the cushion at the lowest
  causes: { label: string; date: string; paid: number }[]; // the outflows since the last money in
  actBy: string; // the day before it starts (today if it starts today)
};

const DAY = 86_400_000;
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(toUtc(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);
const r2 = (n: number) => Math.round(n * 100) / 100;

// What an outflow actually takes: a card's minimum when paying minimums only.
function paidFor(e: CashEvent, minimumOnly: boolean) {
  if (e.kind === "CARD" && minimumOnly && e.minimumUsd != null) return Math.min(e.usd, e.minimumUsd);
  return e.usd;
}

export function cashPlan(input: PlanInput) {
  const days = input.days ?? 30;
  const minimumOnly = !!input.cardsMinimumOnly;
  const spendNow = Math.max(0, input.spendNowUsd ?? 0);
  const save = Math.max(0, input.savePerPaydayUsd ?? 0);
  const last = addDays(input.today, days - 1);

  // Anything already past due is due today.
  const events = input.events
    .map((e) => (e.date < input.today ? { ...e, date: input.today } : e))
    .filter((e) => e.date <= last)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "PAYCHECK" ? -1 : 1));

  // What-ifs as events of their own, so they show on the timeline.
  const whatIfs: CashEvent[] = [];
  if (spendNow > 0) whatIfs.push({ key: "whatif:spend", date: input.today, label: "What if: spend", kind: "BILL", usd: spendNow });
  if (save > 0) {
    whatIfs.push({ key: "whatif:save:0", date: input.today, label: "What if: save", kind: "BILL", usd: save });
    for (const p of events.filter((e) => e.kind === "PAYCHECK" && e.date > input.today)) {
      whatIfs.push({ key: `whatif:save:${p.date}`, date: p.date, label: "What if: save", kind: "BILL", usd: save });
    }
  }
  const all = [...events, ...whatIfs];

  // Day by day. Everyday spending starts tomorrow (today's is mostly in).
  const timeline: PlanDay[] = [];
  let balance = input.cashUsd;
  for (let i = 0; i < days; i++) {
    const date = addDays(input.today, i);
    const todays = all.filter((e) => e.date === date).map((e) => ({ ...e, paid: e.kind === "PAYCHECK" ? e.usd : paidFor(e, minimumOnly) }));
    for (const e of todays) balance += e.kind === "PAYCHECK" ? e.paid : -e.paid;
    const everyday = i === 0 ? 0 : input.everydayDailyUsd;
    balance -= everyday;
    timeline.push({ date, balance: r2(balance), events: todays, everyday: r2(everyday) });
  }

  // Safe to spend until payday: cash less what's due before it (bills only,
  // not the everyday spending that "safe to spend" is there to cover).
  const payday = input.nextPayday && input.nextPayday > input.today ? input.nextPayday : null;
  const before = all.filter((e) => e.kind !== "PAYCHECK" && (!payday || e.date < payday) && (payday || e.date <= last));
  const dueBeforePayday = before.filter((e) => !e.key.startsWith("whatif:"));
  const committed = r2(dueBeforePayday.reduce((s, e) => s + paidFor(e, minimumOnly), 0));
  const whatIfNow = r2(before.filter((e) => e.key.startsWith("whatif:")).reduce((s, e) => s + e.usd, 0));
  // Money set aside for the year ahead isn't free either -- beyond what it
  // pays for before payday, which is already in `committed`.
  const plannedSoon = (input.plannedDue ?? []).filter((d) => (payday ? d.date < payday : d.date <= last)).reduce((s, d) => s + d.usd, 0);
  const held = r2(Math.max(0, (input.setAsideUsd ?? 0) - plannedSoon));
  const safe = r2(input.cashUsd - committed - whatIfNow - held);
  const daysToPayday = payday ? daysBetween(input.today, payday) : null;

  // Spells under the cushion, with the outflows that led into each.
  const tight: TightSpell[] = [];
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].balance >= input.cushionUsd) continue;
    let j = i;
    while (j + 1 < timeline.length && timeline[j + 1].balance < input.cushionUsd) j++;
    const spell = timeline.slice(i, j + 1);
    const low = spell.reduce((m, d) => (d.balance < m.balance ? d : m), spell[0]);
    // Back to the last day money came in (or today).
    let k = i;
    while (k > 0 && !timeline[k].events.some((e) => e.kind === "PAYCHECK")) k--;
    const causes = timeline
      .slice(k, timeline.indexOf(low) + 1)
      .flatMap((d) => d.events.filter((e) => e.kind !== "PAYCHECK").map((e) => ({ label: e.label, date: d.date, paid: r2(e.paid) })))
      .sort((a, b) => b.paid - a.paid)
      .slice(0, 3);
    tight.push({
      start: timeline[i].date,
      end: timeline[j].date,
      lowest: low.balance,
      lowestDate: low.date,
      under: r2(input.cushionUsd - low.balance),
      causes,
      actBy: i === 0 ? input.today : addDays(timeline[i].date, -1),
    });
    i = j;
  }

  const lowest = timeline.reduce((m, d) => (d.balance < m.balance ? d : m), timeline[0]);
  return {
    safe,
    committed,
    whatIfNow,
    held,
    perDay: daysToPayday && daysToPayday > 0 ? r2(Math.max(0, safe) / daysToPayday) : null,
    daysToPayday,
    payday,
    dueBeforePayday: dueBeforePayday.map((e) => ({ ...e, paid: r2(paidFor(e, minimumOnly)) })),
    timeline,
    lowest: { date: lowest.date, balance: lowest.balance },
    endBalance: timeline[timeline.length - 1].balance,
    tight,
  };
}

// How long to the emergency fund target saving $X each paycheck (26 a year).
// A spend now that leaves cash short is assumed to come out of the fund.
export function emergencyTimeline(input: {
  fundUsd: number;
  targetUsd: number;
  essentialsMonthly: number;
  savePerPaydayUsd: number;
  shortfallUsd?: number; // money the fund has to cover now
  today: string;
}) {
  const fund = Math.max(0, input.fundUsd - Math.max(0, input.shortfallUsd ?? 0) + input.savePerPaydayUsd); // today's move counts
  const gap = Math.max(0, input.targetUsd - fund);
  const monthsCovered = input.essentialsMonthly > 0 ? Math.round((fund / input.essentialsMonthly) * 10) / 10 : null;
  if (gap <= 0.005) return { fundAfter: r2(fund), gap: 0, paychecks: 0, reachBy: input.today, months: 0, monthsCovered };
  if (input.savePerPaydayUsd <= 0) return { fundAfter: r2(fund), gap: r2(gap), paychecks: null, reachBy: null, months: null, monthsCovered };
  const paychecks = Math.ceil(gap / input.savePerPaydayUsd);
  const reachBy = addDays(input.today, paychecks * 14);
  return { fundAfter: r2(fund), gap: r2(gap), paychecks, reachBy, months: Math.round(((paychecks * 14) / 30.44) * 10) / 10, monthsCovered };
}

// Repeat a bill every `intervalDays` (or each calendar month / year) from its
// next date through the window.
export function occurrences(next: string, frequency: string, intervalDays: number, from: string, to: string): string[] {
  const out: string[] = [];
  let d = next;
  for (let i = 0; i < 400 && d <= to; i++) {
    if (d >= from) out.push(d);
    if (frequency === "MONTHLY") d = addMonths(next, i + 1);
    else if (frequency === "YEARLY") d = addMonths(next, 12 * (i + 1));
    else d = addDays(d, Math.max(1, Math.round(intervalDays)));
  }
  return out;
}

export function addMonths(d: string, n: number) {
  const [y, m, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}
