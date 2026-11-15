// Debt payoff plan: month by month, when each debt is cleared, when the
// household is debt-free, and what the interest comes to -- for the
// avalanche (highest rate first) and snowball (smallest balance first)
// orders, with or without extra money each month. Pure.
//
// Each month every debt earns a month's interest and gets its own payment;
// whatever is left of the monthly total (the extra, plus the payments of
// debts already cleared) goes to the debt the strategy puts first. So the
// total paid each month stays the same until everything is gone.
// Money is approximate USD; months are YYYY-MM.

export type Strategy = "avalanche" | "snowball";

export type PayoffDebt = {
  id: string;
  name: string;
  balanceUsd: number;
  ratePct: number | null; // annual %, null when not recorded (treated as 0)
  monthlyUsd: number; // its own payment per month; 0 when no instalment is set
};

export type PayoffRow = {
  id: string;
  name: string;
  order: number; // 1 = cleared first
  startUsd: number;
  ratePct: number | null;
  monthlyUsd: number;
  months: number | null; // months until cleared; null if it never is
  clearedMonth: string | null;
  interestUsd: number;
};

const MAX_MONTHS = 600; // 50 years: past this, it isn't being paid off
const r2 = (n: number) => Math.round(n * 100) / 100;

export function addMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

// A weekly or biweekly instalment as a monthly amount.
export function monthlyOf(amount: number | null, frequency: string | null): number {
  if (!amount || amount <= 0) return 0;
  return frequency === "WEEKLY" ? (amount * 52) / 12 : frequency === "BIWEEKLY" ? (amount * 26) / 12 : amount;
}

export function payoffPlan(debts: PayoffDebt[], opts: { strategy: Strategy; extraMonthlyUsd?: number; startMonth: string }) {
  const extra = Math.max(0, opts.extraMonthlyUsd ?? 0);
  const live = debts.filter((d) => d.balanceUsd > 0.005).map((d) => ({ ...d, balance: d.balanceUsd, interest: 0, months: null as number | null }));
  const budget = live.reduce((s, d) => s + d.monthlyUsd, 0) + extra;
  const rate = (d: { ratePct: number | null }) => (d.ratePct ?? 0) / 100 / 12;
  // Which debt the spare money goes to next.
  const first = (open: typeof live) =>
    [...open].sort((a, b) => (opts.strategy === "avalanche" ? (b.ratePct ?? 0) - (a.ratePct ?? 0) || a.balance - b.balance : a.balance - b.balance || (b.ratePct ?? 0) - (a.ratePct ?? 0)))[0];

  const balances: number[] = [r2(live.reduce((s, d) => s + d.balance, 0))];
  let month = 0;
  while (live.some((d) => d.balance > 0.005) && month < MAX_MONTHS) {
    month++;
    let left = budget;
    for (const d of live) {
      if (d.balance <= 0.005) continue;
      const i = d.balance * rate(d);
      d.interest += i;
      d.balance += i;
      const pay = Math.min(d.monthlyUsd, d.balance, left);
      d.balance -= pay;
      left -= pay;
    }
    // The spare money, to one debt after another in the strategy's order.
    while (left > 0.005) {
      const open = live.filter((d) => d.balance > 0.005);
      if (!open.length) break;
      const d = first(open);
      const pay = Math.min(left, d.balance);
      d.balance -= pay;
      left -= pay;
    }
    for (const d of live) if (d.months == null && d.balance <= 0.005) d.months = month;
    balances.push(r2(live.reduce((s, d) => s + Math.max(0, d.balance), 0)));
  }

  const done = live.every((d) => d.months != null);
  const rows: PayoffRow[] = [...live]
    .sort((a, b) => (a.months ?? Infinity) - (b.months ?? Infinity) || b.balance - a.balance)
    .map((d, i) => ({
      id: d.id,
      name: d.name,
      order: i + 1,
      startUsd: r2(d.balanceUsd),
      ratePct: d.ratePct,
      monthlyUsd: r2(d.monthlyUsd),
      months: d.months,
      clearedMonth: d.months == null ? null : addMonth(opts.startMonth, d.months),
      interestUsd: r2(d.interest),
    }));
  return {
    rows,
    done, // false: at this rate something is never paid off
    months: done ? month : null,
    debtFreeMonth: done && live.length ? addMonth(opts.startMonth, month) : null,
    interestUsd: r2(live.reduce((s, d) => s + d.interest, 0)),
    monthlyBudgetUsd: r2(budget),
    balances: done ? balances : balances.slice(0, 121), // total owed at the end of each month
  };
}

export type PayoffPlan = ReturnType<typeof payoffPlan>;
