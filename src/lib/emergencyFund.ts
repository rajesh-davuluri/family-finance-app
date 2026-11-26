// How many months of essential spending the bank cash covers, and what it
// takes to reach the target. Pure.

// Spending that can't stop if income does: rent, EMIs and bills (by kind),
// plus groceries, fuel, medical, insurance, utilities and childcare by name.
export const ESSENTIAL_NAME = /grocer|kirana|\bgas\b|fuel|petrol|medic|health|pharm|insur|utilit|electric|water|internet|phone|mobile|child|daycare|school|tuition|transport/i;
export function isEssential(kind: string, categoryName: string): boolean {
  return kind === "BILL" || kind === "DEBT_PAYMENT" || (kind === "SPENDING" && ESSENTIAL_NAME.test(categoryName));
}

export function emergencyFund(input: { cashUsd: number; months: { essentials: number; total: number }[]; targetMonths: number; paychecksPerYear?: number }) {
  const n = input.months.length;
  const essentials = n ? input.months.reduce((s, m) => s + m.essentials, 0) / n : 0;
  const total = n ? input.months.reduce((s, m) => s + m.total, 0) / n : 0;
  const covered = essentials > 0 ? input.cashUsd / essentials : null;
  const target = essentials * input.targetMonths;
  const gap = Math.max(0, target - input.cashUsd);
  const perYear = input.paychecksPerYear ?? 26;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    essentialsMonthly: r(essentials),
    totalMonthly: r(total),
    monthsCovered: covered == null ? null : Math.round(covered * 10) / 10,
    monthsCoveredAllSpending: total > 0 ? Math.round((input.cashUsd / total) * 10) / 10 : null,
    target: r(target),
    gap: r(gap),
    // Reaching the target in 6 or 12 months, saved from each paycheck.
    perPaycheck6: r(gap / (perYear / 2)),
    perPaycheck12: r(gap / perYear),
  };
}

// How fast the fund is growing and when it reaches the target at that pace.
// `added` is the net money put in (minus taken out) since `since`, a
// YYYY-MM-DD no more than three months back (later when the fund's records
// start later). The window counts as at least one month, so one deposit
// made today isn't read as a pace of thousands a day. Pure.
export const PACE_MONTHS = 3;
const DAYS_PER_MONTH = 30.44;
const MAX_MONTHS_AHEAD = 120;

export function fundPace(input: { added: number; since: string; today: string; gap: number }) {
  const days = (Date.parse(input.today) - Date.parse(input.since)) / 86_400_000;
  const months = Math.max(1, days / DAYS_PER_MONTH);
  const perMonth = Math.round((input.added / months) * 100) / 100;
  let monthsToTarget: number | null = null;
  let reachBy: string | null = null; // YYYY-MM
  if (input.gap <= 0.5) monthsToTarget = 0;
  else if (perMonth > 0.5) {
    const need = Math.ceil(input.gap / perMonth);
    if (need <= MAX_MONTHS_AHEAD) {
      monthsToTarget = need;
      const [y, m] = input.today.split("-").map(Number);
      reachBy = new Date(Date.UTC(y, m - 1 + need, 1)).toISOString().slice(0, 7);
    }
  }
  return { perMonth, paceMonths: Math.round(months * 10) / 10, monthsToTarget, reachBy };
}

// The day `months` calendar months before a YYYY-MM-DD (clamped to the
// month's last day, so Mar 31 less one month is Feb 28/29).
export function monthsBefore(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 - months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 - months, Math.min(d, last))).toISOString().slice(0, 10);
}
