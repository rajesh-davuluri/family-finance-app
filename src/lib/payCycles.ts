// Pure helpers behind the Paychecks page: turn salary deposits into biweekly
// pay cycles, and a cycle's transactions into "where did this paycheck go".
// No React, no Prisma, so the date math can be tested on its own.
//
// Rules:
// - A pay cycle runs from one actual paycheck to the day before the next
//   one. Actual deposit dates always win; an early or late paycheck moves
//   the boundary with it.
// - Future paydays are projected from the last actual one, every 14 days.
//   They're "expected" until a Salary transaction confirms them.
// - Only the latest run of roughly-biweekly salary entries counts. Salary
//   logged once a month (e.g. $6,200 on the 1st) can't be split into real
//   pay cycles, so those months stay in the monthly reports instead.
// - Money is compared in approximate USD, like the rest of the dashboard.

export const PAY_INTERVAL_DAYS = 14;
// Gaps up to this long still count as the same biweekly run (a paycheck a
// few days late, or one skipped entry would be 28).
const MAX_GAP_IN_RUN = 21;

export type CycleTransaction = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  usd: number;
  notes: string | null;
  categoryId: string;
  categoryName: string;
  direction: "INCOME" | "EXPENSE";
  instrumentName: string;
};

export type Payday = { date: string; usd: number; amount: number; currency: string; transactionId: string };

export type ExpectedPayday = { date: string; holiday: string | null; likelyDate: string | null };

export type Cycle = {
  index: number;
  start: string; // the payday
  end: string; // the day before the next payday (actual or expected)
  nextPayday: string;
  nextConfirmed: boolean;
  paycheck: Payday;
  isCurrent: boolean;
};

// --- date helpers (calendar dates as YYYY-MM-DD, computed in UTC) ---------

function toUtc(d: string) {
  return Date.parse(`${d}T00:00:00Z`);
}

export function addDays(d: string, days: number): string {
  return new Date(toUtc(d) + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

function weekday(d: string) {
  return new Date(toUtc(d)).getUTCDay(); // 0 = Sunday
}

// Fixed-date US bank holidays a Friday payday can land on. When one does,
// payroll usually arrives the business day before.
const FIXED_HOLIDAYS: Record<string, string> = {
  "01-01": "New Year's Day",
  "06-19": "Juneteenth",
  "07-04": "Independence Day",
  "11-11": "Veterans Day",
  "12-25": "Christmas Day",
};

function previousBusinessDay(d: string) {
  let x = addDays(d, -1);
  while (weekday(x) === 0 || weekday(x) === 6 || FIXED_HOLIDAYS[x.slice(5)]) x = addDays(x, -1);
  return x;
}

// --- paydays and cycles -------------------------------------------------------

// The latest run of salary deposits spaced roughly two weeks apart, oldest
// first. Several deposits on one day (a split paycheck) count as one payday.
export function biweeklyPaydays(salaries: Payday[]): { paydays: Payday[]; earlierIgnored: number } {
  const byDay = new Map<string, Payday>();
  for (const s of [...salaries].sort((a, b) => a.date.localeCompare(b.date))) {
    const prev = byDay.get(s.date);
    byDay.set(
      s.date,
      prev ? { ...prev, usd: prev.usd + s.usd, amount: prev.currency === s.currency ? prev.amount + s.amount : prev.amount } : { ...s }
    );
  }
  const days = Array.from(byDay.values());
  let start = days.length - 1;
  while (start > 0 && daysBetween(days[start - 1].date, days[start].date) <= MAX_GAP_IN_RUN) start--;
  return { paydays: days.slice(Math.max(0, start)), earlierIgnored: Math.max(0, start) };
}

export function expectedPaydays(lastPayday: string, count: number): ExpectedPayday[] {
  const out: ExpectedPayday[] = [];
  for (let i = 1; i <= count; i++) {
    const date = addDays(lastPayday, PAY_INTERVAL_DAYS * i);
    const holiday = FIXED_HOLIDAYS[date.slice(5)] ?? null;
    out.push({ date, holiday, likelyDate: holiday ? previousBusinessDay(date) : null });
  }
  return out;
}

export function buildCycles(paydays: Payday[]): Cycle[] {
  return paydays.map((p, i) => {
    const next = paydays[i + 1];
    const nextPayday = next ? next.date : addDays(p.date, PAY_INTERVAL_DAYS);
    const end = addDays(nextPayday, -1);
    return {
      index: i,
      start: p.date,
      end,
      nextPayday,
      nextConfirmed: !!next,
      paycheck: p,
      // The latest cycle stays current until the next paycheck is recorded,
      // even if that paycheck is late.
      isCurrent: !next,
    };
  });
}

// --- where the money went ---------------------------------------------------

export type Bucket = "SALARY" | "OTHER_INCOME" | "BILLS" | "DEBT" | "SAVINGS" | "SPENDING" | "LOAN";

export const BUCKET_LABELS: Record<Bucket, string> = {
  SALARY: "Salary",
  OTHER_INCOME: "Other income",
  BILLS: "Bills",
  DEBT: "Debt payments",
  SAVINGS: "Savings & investing",
  SPENDING: "Everyday spending",
  LOAN: "Loans given / received",
};

// Until categories carry an explicit type, the bucket comes from the
// category's name. Kept in one place so it's easy to see and adjust.
export function bucketOf(categoryName: string, direction: "INCOME" | "EXPENSE"): Bucket {
  const n = categoryName.toLowerCase();
  // Borrowing, lending and repayments move money but aren't income or spending.
  if (/\b(hand loan|loan repayment|money lent|lent|borrow)/.test(n)) return "LOAN";
  if (direction === "INCOME") return /salary|paycheck|payroll/.test(n) ? "SALARY" : "OTHER_INCOME";
  if (/invest|saving|retire|401k|brokerage|\bira\b/.test(n)) return "SAVINGS";
  if (/loan|emi|debt/.test(n)) return "DEBT";
  if (/rent|mortgage|utilit|insurance|phone|mobile|internet|electric|water/.test(n)) return "BILLS";
  return "SPENDING";
}

const round = (n: number) => Math.round(n * 100) / 100;

export type CategorySlice = { categoryId: string; label: string; bucket: Bucket; total: number; count: number; share: number };

export function summarizeCycle(cycle: Cycle, txns: CycleTransaction[], today: string) {
  const inCycle = txns.filter((t) => t.date >= cycle.start && t.date <= cycle.end);
  const totals: Record<Bucket, number> = { SALARY: 0, OTHER_INCOME: 0, BILLS: 0, DEBT: 0, SAVINGS: 0, SPENDING: 0, LOAN: 0 };
  const cats = new Map<string, { label: string; bucket: Bucket; total: number; count: number }>();
  for (const t of inCycle) {
    const bucket = bucketOf(t.categoryName, t.direction);
    totals[bucket] += bucket === "LOAN" && t.direction === "EXPENSE" ? -t.usd : t.usd;
    if (t.direction === "EXPENSE" && bucket !== "LOAN") {
      const c = cats.get(t.categoryId) ?? { label: t.categoryName, bucket, total: 0, count: 0 };
      c.total += t.usd;
      c.count += 1;
      cats.set(t.categoryId, c);
    }
  }
  // The paycheck that opened the cycle is its salary, even if more salary
  // rows were logged the same day (they're merged into the payday).
  const salary = round(Math.max(totals.SALARY, cycle.paycheck.usd));
  const otherIncome = round(totals.OTHER_INCOME);
  const bills = round(totals.BILLS);
  const debt = round(totals.DEBT);
  const savings = round(totals.SAVINGS);
  const spending = round(totals.SPENDING);
  const spent = round(bills + debt + spending);
  const moneyIn = round(salary + otherIncome);
  const outTotal = round(spent + savings);
  const leftOver = round(moneyIn - outTotal);

  const expenseSum = Array.from(cats.values()).reduce((s, c) => s + c.total, 0) || 1;
  const byCategory: CategorySlice[] = Array.from(cats.entries())
    .map(([categoryId, c]) => ({ categoryId, label: c.label, bucket: c.bucket, total: round(c.total), count: c.count, share: c.total / expenseSum }))
    .sort((a, b) => b.total - a.total);

  const length = daysBetween(cycle.start, cycle.end) + 1;
  const lastDay = today < cycle.end ? today : cycle.end;
  const elapsed = Math.min(length, Math.max(0, daysBetween(cycle.start, lastDay) + 1));

  return {
    salary,
    otherIncome,
    moneyIn,
    bills,
    debt,
    savings,
    spending,
    spent,
    outTotal,
    leftOver,
    // Borrowed/lent/repaid in this cycle: shown separately, never in the totals above.
    loansNet: round(totals.LOAN),
    byCategory,
    transactions: inCycle,
    days: length,
    daysElapsed: elapsed,
    daysLeft: Math.max(0, daysBetween(lastDay, cycle.end)),
  };
}

export type CycleSummary = ReturnType<typeof summarizeCycle>;
