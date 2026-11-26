// What kind of money movement a category records, which decides how its
// transactions count in every total. A category's `direction` (INCOME or
// EXPENSE) still says which way money moves for account balances; its kind
// says whether that is really income, spending, saving, or neither:
//
//   INCOME        salary, interest, rent received -> income
//   REFUND        money back for a purchase       -> reduces spending
//   SPENDING      everyday purchases              -> spending
//   BILL          rent, utilities, phone, insurance -> spending (fixed)
//   DEBT_PAYMENT  car loan, EMI, personal loan instalments -> spending
//   SAVINGS       investing, moving money to savings -> savings, not spending
//   TRANSFER      paying a credit card, moving between own accounts -> neither
//   LOAN          borrowing, lending, repaying a personal loan -> neither
//
// Kind is stored on the category; categories that don't have one yet get a
// guess from their name (inferKind), shown as such on the Categories page.

import { z } from "zod";

export const CATEGORY_KINDS = ["INCOME", "REFUND", "SPENDING", "BILL", "DEBT_PAYMENT", "SAVINGS", "TRANSFER", "LOAN"] as const;
export const CategoryKind = z.enum(CATEGORY_KINDS);
export type CategoryKind = z.infer<typeof CategoryKind>;
type Direction = "INCOME" | "EXPENSE";

export const KIND_LABELS: Record<CategoryKind, string> = {
  INCOME: "Income",
  REFUND: "Refund",
  SPENDING: "Spending",
  BILL: "Bill",
  DEBT_PAYMENT: "Debt payment",
  SAVINGS: "Savings",
  TRANSFER: "Transfer",
  LOAN: "Loan",
};

export const KIND_HELP: Record<CategoryKind, string> = {
  INCOME: "Counts as income",
  REFUND: "Money back — reduces spending, not income",
  SPENDING: "Everyday spending",
  BILL: "Regular bills — counts as spending",
  DEBT_PAYMENT: "Loan or EMI instalments — counts as spending",
  SAVINGS: "Investing or saving — not spending",
  TRANSFER: "Card payments, moves between your accounts — not income or spending",
  LOAN: "Money borrowed, lent or repaid — not income or spending",
};

// Which kinds make sense for each direction of money.
export const KINDS_FOR_DIRECTION: Record<Direction, CategoryKind[]> = {
  INCOME: ["INCOME", "REFUND", "TRANSFER", "LOAN"],
  EXPENSE: ["SPENDING", "BILL", "DEBT_PAYMENT", "SAVINGS", "TRANSFER", "LOAN"],
};

export function isKindAllowed(kind: CategoryKind, direction: Direction) {
  return KINDS_FOR_DIRECTION[direction].includes(kind);
}

// A best guess from the category's name, for categories without a stored kind.
export function inferKind(name: string, direction: Direction): CategoryKind {
  const n = name.toLowerCase();
  if (/card payment|credit card bill|transfer|self transfer|own account/.test(n)) return "TRANSFER";
  if (/hand loan|loan repayment|money lent|\blent\b|borrow/.test(n)) return "LOAN";
  if (direction === "INCOME") return /refund|cashback|reimburse|return/.test(n) ? "REFUND" : "INCOME";
  if (/invest|saving|retire|401k|brokerage|\bira\b|mutual fund|\bsip\b/.test(n)) return "SAVINGS";
  if (/loan|emi|debt|mortgage/.test(n)) return /mortgage|rent/.test(n) ? "BILL" : "DEBT_PAYMENT";
  if (/rent|utilit|insurance|phone|mobile|internet|electric|water|tuition/.test(n)) return "BILL";
  return "SPENDING";
}

type CategoryLike = { name: string; direction: string; kind?: string | null };

export function kindOf(c: CategoryLike): CategoryKind {
  const direction: Direction = c.direction === "INCOME" ? "INCOME" : "EXPENSE";
  const stored = CategoryKind.safeParse(c.kind);
  if (stored.success && isKindAllowed(stored.data, direction)) return stored.data;
  return inferKind(c.name, direction);
}

// How one transaction of this kind counts, in whatever unit `amount` is in.
// Spending is net of refunds; transfers and loans count nowhere.
export function flowOf(kind: CategoryKind, amount: number): { income: number; spending: number; savings: number } {
  switch (kind) {
    case "INCOME":
      return { income: amount, spending: 0, savings: 0 };
    case "REFUND":
      return { income: 0, spending: -amount, savings: 0 };
    case "SPENDING":
    case "BILL":
    case "DEBT_PAYMENT":
      return { income: 0, spending: amount, savings: 0 };
    case "SAVINGS":
      return { income: 0, spending: 0, savings: amount };
    default:
      return { income: 0, spending: 0, savings: 0 };
  }
}

export function countsAsSpending(kind: CategoryKind) {
  return kind === "SPENDING" || kind === "BILL" || kind === "DEBT_PAYMENT" || kind === "REFUND";
}
