import { toApproxUsd, getDefaultRate } from "@/lib/fx";

// Balance is deliberately never stored on the Debt row itself (see the
// comment in schema.prisma) -- it's always derived here from
// originalPrincipal minus every payment (converted into the debt's own
// currency first, since a debt can be paid down in either USD or INR
// regardless of which currency it was originally taken in), so it can
// never drift out of sync if a payment is later edited or deleted.

export type DebtCurrencyInfo = { currency: string; conversionRateToUsd: number | null };

// Converts an arbitrary amount+currency into the debt's own currency.
// Prefers the debt's own recorded conversion rate (the actual rate at the
// time it was taken out) when the amount's currency is the "foreign" side
// of that specific debt; falls back to the app's generic approximate rate
// table for any other currency pairing (e.g. a EUR payment against an INR
// debt -- an edge case, but handled rather than silently wrong).
export function convertToDebtCurrency(amount: number, fromCurrency: string, debt: DebtCurrencyInfo): number {
  if (fromCurrency === debt.currency) return amount;

  // Step 1: get the amount into USD. fromCurrency is guaranteed different
  // from debt.currency here, so this is always the "other" currency in the
  // pairing -- use the debt's own rate if it's the debt's non-USD currency,
  // otherwise fall back to the generic table (e.g. a EUR payment against an
  // INR debt -- an edge case, but handled rather than silently wrong).
  let usd: number;
  if (fromCurrency === "USD") {
    usd = amount;
  } else {
    usd = toApproxUsd(amount, fromCurrency);
  }

  // Step 2: convert USD into the debt's currency.
  if (debt.currency === "USD") return usd;
  const rate = debt.conversionRateToUsd ?? getDefaultRate(debt.currency);
  return usd / rate;
}

export function computeBalance(
  originalPrincipal: number,
  payments: { amount: number; currency: string }[],
  debt: DebtCurrencyInfo
): number {
  const paid = payments.reduce((sum, p) => sum + convertToDebtCurrency(p.amount, p.currency, debt), 0);
  return Math.round((originalPrincipal - paid) * 100) / 100;
}

// Converts a debt's amount to an approximate USD figure for cross-currency
// comparison ONLY (totals, payoff ordering) -- the real balance shown to the
// person always stays in the debt's own currency everywhere else.
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
