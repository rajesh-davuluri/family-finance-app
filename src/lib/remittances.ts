// Money sent to India: which transactions are transfers abroad, which
// service, and what the exchange rate cost against the market's. Pure.

import { REMITTANCE } from "@/lib/bankRules";

export function isRemittance(t: { categoryName: string; categoryKind: string; notes: string | null; currency: string }): boolean {
  if (t.currency !== "USD") return false;
  if (REMITTANCE.test(t.notes ?? "")) return true;
  return t.categoryKind === "TRANSFER" && /india|remit|abroad|overseas|international/i.test(t.categoryName);
}

const SERVICES: [RegExp, string][] = [
  [/crobo|cybrid/i, "Crobo"],
  [/remitly/i, "Remitly"],
  [/\bwise\b|transferwise/i, "Wise"],
  [/xoom/i, "Xoom"],
  [/western\s*union/i, "Western Union"],
  [/remit2india/i, "Remit2India"],
];
export function serviceOf(notes: string | null): string {
  return SERVICES.find(([re]) => re.test(notes ?? ""))?.[1] ?? "Other";
}

export type TransferRow = {
  id: string;
  date: string;
  usd: number;
  service: string;
  notes: string | null;
  inrReceived: number | null; // typed in from the receipt
  feeUsd: number | null;
  marketRate: number | null; // USD->INR that day
};

export type TransferView = TransferRow & {
  yourRate: number | null; // INR per USD actually got, after any fee
  inr: number | null; // received, or estimated at the market rate
  estimated: boolean;
  costUsd: number | null; // what the rate (and fee) cost against the market, in dollars
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function viewTransfer(t: TransferRow): TransferView {
  const fee = t.feeUsd ?? 0;
  if (t.inrReceived != null && t.inrReceived > 0) {
    const yourRate = t.inrReceived / t.usd; // the fee is part of what the dollars bought
    // At the market rate, these rupees would have cost this many dollars.
    const costUsd = t.marketRate ? r2(t.usd - t.inrReceived / t.marketRate) : fee ? r2(fee) : null;
    return { ...t, yourRate: Math.round(yourRate * 100) / 100, inr: t.inrReceived, estimated: false, costUsd };
  }
  return { ...t, yourRate: null, inr: t.marketRate ? r2(t.usd * t.marketRate) : null, estimated: true, costUsd: null };
}

export function summarize(rows: TransferView[]) {
  const usd = r2(rows.reduce((s, t) => s + t.usd, 0));
  const known = rows.filter((t) => !t.estimated);
  const inrKnown = known.reduce((s, t) => s + (t.inr ?? 0), 0);
  const inrAll = rows.reduce((s, t) => s + (t.inr ?? 0), 0);
  const usdKnown = known.reduce((s, t) => s + t.usd, 0);
  const withMarket = known.filter((t) => t.marketRate);
  const marketUsd = withMarket.reduce((s, t) => s + t.usd, 0);
  const byService = new Map<string, { usd: number; count: number; inr: number; usdKnown: number }>();
  for (const t of rows) {
    const b = byService.get(t.service) ?? { usd: 0, count: 0, inr: 0, usdKnown: 0 };
    b.usd += t.usd;
    b.count += 1;
    if (!t.estimated) {
      b.inr += t.inr ?? 0;
      b.usdKnown += t.usd;
    }
    byService.set(t.service, b);
  }
  return {
    count: rows.length,
    usd,
    inr: r2(inrAll),
    inrEstimated: rows.some((t) => t.estimated && t.inr != null),
    yourAvgRate: usdKnown ? Math.round((inrKnown / usdKnown) * 100) / 100 : null,
    // Dollar-weighted market rate on the days of the transfers with a receipt.
    marketAvgRate: marketUsd ? Math.round((withMarket.reduce((s, t) => s + t.usd * t.marketRate!, 0) / marketUsd) * 100) / 100 : null,
    costUsd: r2(known.reduce((s, t) => s + (t.costUsd ?? 0), 0)),
    receiptsMissing: rows.length - known.length,
    services: [...byService.entries()].map(([name, b]) => ({ name, count: b.count, usd: r2(b.usd), rate: b.usdKnown ? Math.round((b.inr / b.usdKnown) * 100) / 100 : null })),
  };
}
