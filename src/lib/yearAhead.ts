// Year ahead: the big costs that don't come every month (a yearly premium, a
// trip to India, school fees), and what to set aside from each paycheck so
// every one of them is covered by the day it's due. Pure: the API gathers
// the inputs (src/lib/yearAheadData.ts) and the page runs the plan, so a
// change to the amounts shows at once.
// Money is approximate USD, dates are YYYY-MM-DD.

import { addDays, addMonths } from "./cashPlan";

export const HORIZON_DAYS = 365;

export const REPEAT_OPTIONS: { months: number | null; label: string }[] = [
  { months: null, label: "One time" },
  { months: 12, label: "Every year" },
  { months: 6, label: "Every 6 months" },
  { months: 3, label: "Every 3 months" },
];
export const repeatLabel = (months: number | null) => REPEAT_OPTIONS.find((r) => r.months === months)?.label ?? `Every ${months} months`;

export type PlannedItem = {
  id: string;
  name: string;
  amount: number; // in `currency`
  currency: string;
  usd: number;
  dueDate: string; // the next time it's due
  repeatMonths: number | null;
  sourceKey: string | null;
};

// One time an item falls due inside the year.
export type Occurrence = {
  key: string;
  itemId: string;
  name: string;
  date: string;
  amount: number;
  currency: string;
  usd: number;
  repeatMonths: number | null;
  overdue: boolean; // due before today and not marked as paid
  first: boolean; // the item's next due date (the one "Mark as paid" settles)
};

// Every time each item falls due from today through the horizon. A due date
// already past still counts (it hasn't been marked as paid); a repeating
// item's later dates follow from it.
export function upcoming(items: PlannedItem[], today: string, horizonDays = HORIZON_DAYS): Occurrence[] {
  const end = addDays(today, horizonDays);
  const out: Occurrence[] = [];
  for (const it of items) {
    const base = { itemId: it.id, name: it.name, amount: it.amount, currency: it.currency, usd: it.usd, repeatMonths: it.repeatMonths };
    if (it.dueDate <= end) out.push({ ...base, key: `${it.id}:${it.dueDate}`, date: it.dueDate, overdue: it.dueDate < today, first: true });
    if (!it.repeatMonths || it.repeatMonths < 1) continue;
    for (let k = 1; k < 500; k++) {
      const date = addMonths(it.dueDate, k * it.repeatMonths);
      if (date > end) break;
      if (date >= today) out.push({ ...base, key: `${it.id}:${date}`, date, overdue: false, first: false });
    }
  }
  return out.sort((a, b) => whenOf(a, today).localeCompare(whenOf(b, today)) || a.name.localeCompare(b.name));
}

// Something overdue has to be paid now.
const whenOf = (o: { date: string; overdue: boolean }, today: string) => (o.overdue ? today : o.date);

export type RowStatus = "COVERED" | "ON_TRACK" | "SHORT";
export type PlanRow = Occurrence & {
  when: string;
  paychecksBefore: number; // paychecks that land by the day it's due
  savedUsd: number; // of the money set aside so far, earliest costs first
  status: RowStatus;
  shortUsd: number; // still missing on the day, at the per-paycheck amount
};

const r2 = (n: number) => Math.round(n * 100) / 100;

// The plan. `paydays` are the paychecks still to come (after today).
//
// Set-aside money is one pot that pays the costs in date order. The amount
// to add each paycheck is the smallest level amount that has the pot full
// enough on every due date:
//   pot + amount x (paychecks by that date) >= every cost due by that date
// so the cost that sets it is the one that needs the most per paycheck left.
// Whatever falls due before the next paycheck and isn't in the pot can't be
// saved for any more -- it has to come out of the bank.
export function yearAheadPlan(input: { today: string; occurrences: Occurrence[]; paydays: string[]; setAsideUsd: number; perPaydayUsd: number | null }) {
  const { today } = input;
  const pot = Math.max(0, input.setAsideUsd);
  const paydays = input.paydays.filter((d) => d > today).sort();
  const occ = input.occurrences.map((o) => ({ ...o, when: whenOf(o, today) })).sort((a, b) => a.when.localeCompare(b.when));
  const paychecksBy = (d: string) => paydays.filter((p) => p <= d).length;

  // What's due before any paycheck, beyond the pot.
  let cum = 0;
  let dueNowShort = 0;
  for (const o of occ) {
    cum += o.usd;
    if (paychecksBy(o.when) === 0) dueNowShort = Math.max(dueNowShort, cum - pot);
  }
  dueNowShort = r2(Math.max(0, dueNowShort));

  // The level amount per paycheck, and the cost that sets it.
  let need = 0;
  let setBy: { name: string; date: string } | null = null;
  cum = 0;
  for (const o of occ) {
    cum += o.usd;
    const n = paychecksBy(o.when);
    if (n === 0) continue;
    const per = (cum - pot - dueNowShort) / n;
    if (per > need + 1e-9) {
      need = per;
      setBy = { name: o.name, date: o.when };
    }
  }
  const needPerPayday = need < 0.005 ? 0 : Math.ceil(need - 1e-9);
  const rate = input.perPaydayUsd != null ? Math.max(0, input.perPaydayUsd) : needPerPayday;

  // Walk the year at that rate: paychecks top the pot up, costs draw it down.
  let potOnly = pot; // the pot as it is today, with nothing added
  let balance = pot;
  let added = 0;
  const rows: PlanRow[] = occ.map((o) => {
    const n = paychecksBy(o.when);
    balance += (n - added) * rate;
    added = n;
    const savedUsd = Math.min(o.usd, potOnly);
    potOnly -= savedUsd;
    const funded = Math.min(o.usd, balance);
    balance -= funded;
    const shortUsd = r2(o.usd - funded);
    const status: RowStatus = savedUsd >= o.usd - 0.005 ? "COVERED" : shortUsd <= 0.005 ? "ON_TRACK" : "SHORT";
    return { ...o, paychecksBefore: n, savedUsd: r2(savedUsd), status, shortUsd: status === "SHORT" ? shortUsd : 0 };
  });

  // By calendar month, for the strip across the top.
  const months: { month: string; usd: number; count: number }[] = [];
  for (let i = 0; i <= 12; i++) {
    const month = addMonths(`${today.slice(0, 7)}-01`, i).slice(0, 7);
    if (month > addDays(today, HORIZON_DAYS).slice(0, 7)) break;
    const inMonth = rows.filter((r) => r.when.slice(0, 7) === month);
    months.push({ month, usd: r2(inMonth.reduce((s, r) => s + r.usd, 0)), count: inMonth.length });
  }

  const totalUsd = r2(rows.reduce((s, r) => s + r.usd, 0));
  const short = rows.filter((r) => r.status === "SHORT");
  return {
    rows,
    months,
    totalUsd,
    setAsideUsd: r2(pot),
    gapUsd: r2(Math.max(0, totalUsd - pot)),
    needPerPayday,
    rate,
    setBy: needPerPayday > 0 ? setBy : null,
    dueNowShort,
    // Setting aside less than it takes: something later comes up short.
    behind: input.perPaydayUsd != null && rate + 0.5 < needPerPayday,
    firstShort: short.find((r) => r.paychecksBefore > 0) ?? null,
    paydaysLeft: paydays.length,
  };
}

export type YearAheadPlan = ReturnType<typeof yearAheadPlan>;
