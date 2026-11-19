// Monthly close: each period, every bank account and credit card is checked
// against the bank's or the card's own figure and closed. Pure -- the data
// and API live in src/lib/periodCloseData.ts and /api/close.
//
// Periods: a bank account closes by calendar month; a card by its statement
// cycle (closed through each statement closing date). A difference can be
// accepted: it's recorded as a balance-adjustment transaction on the account,
// in a category that counts as neither income nor spending, so it shows in
// the history instead of vanishing. Up to the household's tolerance it can
// be accepted as it is; above it a note saying why is required.
// Dates are YYYY-MM-DD.

export const DEFAULT_TOLERANCE_USD = 10;

export type AccountKind = "BANK" | "CARD";
export type CloseStatus = "CLOSED" | "DUE" | "CHANGED" | "NOT_DUE" | "UNAVAILABLE";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

// The last day of the month before `today`'s: the end of the latest
// calendar month that's over.
export function lastMonthEnd(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}

export const monthName = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
export const shortDate = (d: string) => `${SHORT[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
const isMonthEnd = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === day;
};

// How a period is named: "October 2026" for a bank month, "Statement closed
// Oct 28, 2026" for a card, "Through Nov 19, 2026" for any other date.
export function periodLabel(kind: AccountKind, end: string, statementClose?: string | null): string {
  if (kind === "BANK" && isMonthEnd(end)) return monthName(end);
  if (kind === "CARD" && statementClose && statementClose === end) return `Statement closed ${shortDate(end)}`;
  return `Through ${shortDate(end)}`;
}

// Where an account stands for its latest period.
export function closeStatus(input: {
  available: boolean;
  dueEnd: string | null; // end of the latest period that's over
  startsAfterDue?: boolean; // a bank account whose records start after that period
  latest: { periodEnd: string; stillMatches: boolean } | null;
}): CloseStatus {
  if (!input.available) return "UNAVAILABLE";
  if (input.latest && !input.latest.stillMatches) return "CHANGED";
  if (input.latest && input.dueEnd && input.latest.periodEnd >= input.dueEnd) return "CLOSED";
  if (!input.dueEnd || input.startsAfterDue) return input.latest ? "CLOSED" : "NOT_DUE";
  return "DUE";
}

// The transaction that makes the app's figure equal the bank's or card's.
// `diff` is their figure minus the app's. For a bank account a positive
// difference is money in; for a card it's more owed, i.e. a charge.
export function adjustmentFor(kind: AccountKind, diff: number): { direction: "INCOME" | "EXPENSE"; amount: number } {
  const amount = Math.round(Math.abs(diff) * 100) / 100;
  const moneyIn = kind === "BANK" ? diff > 0 : diff < 0;
  return { direction: moneyIn ? "INCOME" : "EXPENSE", amount };
}

export const ADJUSTMENT_CATEGORY = { INCOME: "Balance adjustment (in)", EXPENSE: "Balance adjustment (out)" } as const;

export const withinTolerance = (diffUsd: number, toleranceUsd: number) => Math.abs(diffUsd) <= toleranceUsd + 0.005;
