// Small date helpers for the biweekly pay-cycle calculations in
// src/app/api/pay-cycle/route.ts. Kept separate (rather than inline in the
// route) so the interval math is easy to unit-test and reuse later if a
// "pay cycle" view gets added anywhere else.
//
// Deliberately NOT a fixed calendar assumption: "next paycheck" is always
// derived from the most recent actual Salary transaction + 14 days, not
// from a hardcoded day-of-month. See the route for why.

export const PAY_INTERVAL_DAYS = 14;

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function daysUntil(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
