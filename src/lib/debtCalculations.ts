import { toApproxUsd } from "@/lib/fx";

// Balance is deliberately never stored on the Debt row itself (see the
// comment in schema.prisma) -- it's always derived here from
// originalPrincipal minus the sum of payments, so editing or deleting a
// payment later can never leave a stale balance behind.

export function computeBalance(originalPrincipal: number, payments: { amount: number }[]): number {
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  return Math.round((originalPrincipal - paid) * 100) / 100;
}

// Converts a debt's amount to an approximate USD figure for cross-currency
// comparison ONLY (totals, payoff ordering) -- the real balance shown to the
// person always stays in the debt's own currency everywhere else.
//
// Prefers the rate recorded on the debt itself (the actual rate at the time
// it was taken out) over the app's generic, always-current approximate rate
// table -- a debt's own conversionRateToUsd is a fixed historical fact, so
// it gives a more accurate comparison for that specific debt than today's
// generic rate would.
export function debtToApproxUsd(amount: number, currency: string, conversionRateToUsd?: number | null): number {
  if (currency === "USD") return amount;
  if (conversionRateToUsd) return amount * conversionRateToUsd;
  return toApproxUsd(amount, currency);
}

export type DebtForPayoff = {
  id: string;
  name: string;
  balance: number;
  currency: string;
  conversionRateToUsd: number | null;
  interestRate: number | null;
};

export function orderByAvalanche(debts: DebtForPayoff[]): DebtForPayoff[] {
  return [...debts].sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0));
}

export function orderBySnowball(debts: DebtForPayoff[]): DebtForPayoff[] {
  return [...debts].sort(
    (a, b) =>
      debtToApproxUsd(a.balance, a.currency, a.conversionRateToUsd) -
      debtToApproxUsd(b.balance, b.currency, b.conversionRateToUsd)
  );
}
