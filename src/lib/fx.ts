// Approximate, static FX rates used ONLY to show a rough USD-equivalent
// total on the dashboard when a household mixes currencies. These are NOT
// live rates and NOT accurate for any historical date — the original
// amount + currency is always preserved unchanged on the transaction
// itself; this conversion is display-only.
//
// Update these periodically, or swap in a live FX API later (the previous
// version of this app mentioned wiring one up — this build keeps it simple
// on purpose so there's no external API key required to get started).
const APPROX_RATES_TO_USD: Record<string, number> = {
  USD: 1,
  INR: 0.012,
  EUR: 1.08,
  GBP: 1.27,
};

export function toApproxUsd(amount: number, currency: string): number {
  const rate = APPROX_RATES_TO_USD[currency] ?? 1;
  return amount * rate;
}
