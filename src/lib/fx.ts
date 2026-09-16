// Approximate, static FX rates used ONLY to show a rough USD-equivalent
// total on the dashboard when a household mixes currencies, and as a
// starting point for a debt's own conversion rate. These are NOT live
// rates and NOT accurate for any historical date — the original amount
// and currency are always preserved unchanged on the transaction or debt
// itself; this conversion is display-only.
//
// Update these periodically (currency rates drift meaningfully over
// months, e.g. INR moved from ~83 to ~95 per USD across 2025-2026), or
// swap in a live FX API later — this build keeps it simple on purpose so
// there's no external API key required to get started.
const APPROX_RATES_TO_USD: Record<string, number> = {
  USD: 1,
  INR: 0.0106, // ~94.3 INR per USD — update this line whenever it drifts noticeably
  EUR: 1.08,
  GBP: 1.27,
};

export function toApproxUsd(amount: number, currency: string): number {
  const rate = APPROX_RATES_TO_USD[currency] ?? 1;
  return amount * rate;
}

// Used to pre-fill the "conversion rate" field when adding a debt in a
// non-USD currency -- a reasonable starting point the person can overwrite
// with the actual rate they got at the time.
export function getDefaultRate(currency: string): number {
  return APPROX_RATES_TO_USD[currency] ?? 1;
}
