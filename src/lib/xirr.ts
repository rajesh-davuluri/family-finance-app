// Annual return of dated cash flows (XIRR), as spreadsheets compute it.
// Pure, shared by policies and investments.

const toMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

// Annual rate r where the dated cash flows net to zero (XIRR). Payments
// negative, receipts positive. Null when it can't be solved.
export function xirr(unsorted: { date: string; amount: number }[]): number | null {
  const flows = [...unsorted].sort((a, b) => a.date.localeCompare(b.date));
  if (flows.length < 2 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;
  const t0 = toMs(flows[0].date);
  const years = flows.map((f) => (toMs(f.date) - t0) / (365 * 86_400_000));
  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, years[i]), 0);
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
