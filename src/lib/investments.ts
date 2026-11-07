// Investments: positions from trades (first in, first out), gains split by
// long/short term, returns, allocation and the observations a financial
// analyst would make about the portfolio. Pure -- no Prisma, no React -- so
// the page, the API and Net Worth all compute the same numbers.

import { z } from "zod";
import { xirr } from "./xirr";
import { toApproxUsd } from "./fx";

export const COUNTRIES = ["IN", "US", "OTHER"] as const;
export const Country = z.enum(COUNTRIES);
export const COUNTRY_LABELS: Record<string, string> = { IN: "India", US: "USA", OTHER: "Other" };

export const ACCOUNT_KINDS = ["BROKERAGE", "DEMAT", "RETIREMENT", "MUTUAL_FUND", "CRYPTO", "OTHER"] as const;
export const AccountKind = z.enum(ACCOUNT_KINDS);
export const ACCOUNT_KIND_LABELS: Record<string, string> = {
  BROKERAGE: "Brokerage",
  DEMAT: "Demat / trading",
  RETIREMENT: "Retirement (401k, IRA, NPS)",
  MUTUAL_FUND: "Mutual funds",
  CRYPTO: "Crypto",
  OTHER: "Other",
};

export const ASSET_TYPES = ["STOCK", "ETF", "MUTUAL_FUND", "CRYPTO", "BOND", "OTHER"] as const;
export const AssetType = z.enum(ASSET_TYPES);
export const ASSET_TYPE_LABELS: Record<string, string> = {
  STOCK: "Stocks",
  ETF: "ETFs",
  MUTUAL_FUND: "Mutual funds",
  CRYPTO: "Crypto",
  BOND: "Bonds",
  OTHER: "Other",
};

// Where a price comes from: NSE/BSE and US exchanges and crypto through
// Yahoo Finance, Indian mutual funds through AMFI's daily NAVs (symbol =
// scheme code), anything else typed in.
export const EXCHANGES = ["NSE", "BSE", "US", "AMFI", "CRYPTO", "OTHER"] as const;
export const Exchange = z.enum(EXCHANGES);
export const EXCHANGE_LABELS: Record<string, string> = {
  NSE: "NSE (India)",
  BSE: "BSE (India)",
  US: "US (NYSE / Nasdaq)",
  AMFI: "Indian mutual fund (AMFI scheme code)",
  CRYPTO: "Crypto",
  OTHER: "Other (price typed in)",
};

export const TRADE_TYPES = ["BUY", "SELL", "DIVIDEND"] as const;
export const TradeType = z.enum(TRADE_TYPES);

export type Trade = {
  id?: string;
  type: string;
  date: string; // YYYY-MM-DD
  quantity: number | null;
  price: number | null;
  fees: number | null;
  amount: number | null;
  notes?: string | null;
  // The date is a stand-in (e.g. imported from a holdings statement, which
  // lists no buy dates): good enough for long/short term, not for returns.
  approx?: boolean;
};

// Notes the app puts on a trade whose date is a stand-in.
export const APPROX_DATE_NOTE = "Approximate date";
export const isApproxNote = (notes: string | null | undefined) => !!notes && notes.startsWith(APPROX_DATE_NOTE);

export type Lot = { date: string; quantity: number; unitCost: number; approx?: boolean };
export type Realized = { date: string; quantity: number; proceeds: number; cost: number; gain: number; days: number; longTerm: boolean };

const EPS = 1e-9;
const day = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
export const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / 86_400_000);
const addDays = (d: string, n: number) => new Date(day(d) + n * 86_400_000).toISOString().slice(0, 10);

// Days held after which a gain is long-term. India: listed shares, equity
// funds and ETFs after 12 months, other assets after 24; crypto is taxed the
// same either way (null). US: after one year.
export function longTermDays(country: string, assetType: string): number | null {
  if (country === "IN") {
    if (assetType === "CRYPTO") return null;
    return assetType === "STOCK" || assetType === "ETF" || assetType === "MUTUAL_FUND" ? 365 : 730;
  }
  return 365;
}

// Units held, their cost and realized gains, matching each sale against the
// oldest units first (FIFO, as both India and the US do by default).
export function position(trades: Trade[], ltDays: number | null) {
  const order = (t: Trade) => (t.type === "BUY" ? 0 : t.type === "SELL" ? 1 : 2);
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));
  const lots: Lot[] = [];
  const realized: Realized[] = [];
  let dividends = 0;
  let oversold = 0;
  for (const t of sorted) {
    if (t.type === "DIVIDEND") {
      dividends += t.amount ?? 0;
      continue;
    }
    const qty = t.quantity ?? 0;
    const price = t.price ?? 0;
    if (qty <= 0) continue;
    if (t.type === "BUY") {
      lots.push({ date: t.date, quantity: qty, unitCost: (qty * price + (t.fees ?? 0)) / qty, approx: t.approx });
    } else if (t.type === "SELL") {
      let left = qty;
      const netUnit = (qty * price - (t.fees ?? 0)) / qty;
      while (left > EPS && lots.length) {
        const lot = lots[0];
        const take = Math.min(lot.quantity, left);
        const days = daysBetween(lot.date, t.date);
        realized.push({
          date: t.date,
          quantity: take,
          proceeds: take * netUnit,
          cost: take * lot.unitCost,
          gain: take * (netUnit - lot.unitCost),
          days,
          longTerm: ltDays !== null && days > ltDays,
        });
        lot.quantity -= take;
        left -= take;
        if (lot.quantity <= EPS) lots.shift();
      }
      if (left > EPS) oversold += left;
    }
  }
  const quantity = lots.reduce((s, l) => s + l.quantity, 0);
  const invested = lots.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  return {
    quantity,
    invested,
    avgCost: quantity > EPS ? invested / quantity : 0,
    lots,
    realized,
    realizedGain: realized.reduce((s, r) => s + r.gain, 0),
    dividends,
    oversold,
  };
}

// Cost of the units still held on a date (what Net Worth counts for past months).
export function costHeldAt(trades: Trade[], date: string): number {
  return position(
    trades.filter((t) => t.date <= date),
    null,
  ).invested;
}

export type Fx = { USDINR: number };

export function toUsd(amount: number, currency: string, fx: Fx): number {
  if (currency === "USD") return amount;
  if (currency === "INR") return amount / fx.USDINR;
  return toApproxUsd(amount, currency);
}

export type HoldingInput = {
  id: string;
  symbol: string;
  name: string | null;
  exchange: string;
  assetType: string;
  sector: string | null;
  currency: string;
  country: string;
  accountId: string;
  accountName: string;
  price: number | null;
  priceAt: string | null; // ISO
  priceSource: string | null;
  trades: Trade[];
  // In a retirement account (401(k), IRA, NPS): gains aren't taxed until
  // withdrawal, so no long/short-term split or tax notes.
  taxDeferred?: boolean;
};

export type NextLongTerm = { date: string; days: number; quantity: number; gain: number };

export type HoldingRow = HoldingInput & {
  quantity: number;
  avgCost: number;
  invested: number;
  value: number | null;
  gain: number | null;
  gainPct: number | null;
  longTermGain: number | null;
  shortTermGain: number | null;
  nextLongTerm: NextLongTerm | null;
  realizedGain: number;
  dividends: number;
  xirr: number | null;
  valueUsd: number;
  investedUsd: number;
  weight: number; // share of the portfolio's value
  oversold: number;
  realized: Realized[];
  closed: boolean; // everything sold
  approxDates: boolean; // some buy dates are stand-ins: no yearly return
};

export type Insight = { level: "warn" | "info" | "good"; text: string };
export type Slice = { key: string; label: string; valueUsd: number; weight: number };

export function fmtMoney(currency: string, n: number, digits = 0) {
  const s = Math.abs(n).toLocaleString(currency === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `;
  return `${n < 0 ? "-" : ""}${sym}${s}`;
}

// The Indian financial year (Apr-Mar) a date falls in, as its start year.
export const indianFyStart = (d: string) => (Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);

// Long-term gains on Indian listed equity are tax-free up to this much a
// financial year (Budget 2024: ₹1.25 lakh; 12.5% above it, 20% short-term).
export const INDIA_LTCG_EXEMPTION = 125_000;

const STALE_DAYS = 7;

export function analyze(holdings: HoldingInput[], fx: Fx, today: string) {
  const rows: HoldingRow[] = holdings.map((h) => {
    const lt = h.taxDeferred ? null : longTermDays(h.country, h.assetType);
    const pos = position(h.trades, lt);
    const value = h.price !== null ? pos.quantity * h.price : null;
    let longTermGain: number | null = null;
    let shortTermGain: number | null = null;
    let nextLongTerm: NextLongTerm | null = null;
    if (h.price !== null && !h.taxDeferred) {
      longTermGain = 0;
      shortTermGain = 0;
      for (const lot of pos.lots) {
        const gain = lot.quantity * (h.price - lot.unitCost);
        const held = daysBetween(lot.date, today);
        if (lt !== null && held > lt) longTermGain += gain;
        else {
          shortTermGain += gain;
          if (lt !== null && !lot.approx) {
            const days = lt + 1 - held;
            if (!nextLongTerm || days < nextLongTerm.days) nextLongTerm = { date: addDays(lot.date, lt + 1), days, quantity: lot.quantity, gain };
            else if (days === nextLongTerm.days) {
              nextLongTerm.quantity += lot.quantity;
              nextLongTerm.gain += gain;
            }
          }
        }
      }
    }
    const flows = h.trades
      .map((t) => ({
        date: t.date,
        amount:
          t.type === "BUY"
            ? -((t.quantity ?? 0) * (t.price ?? 0) + (t.fees ?? 0))
            : t.type === "SELL"
              ? (t.quantity ?? 0) * (t.price ?? 0) - (t.fees ?? 0)
              : (t.amount ?? 0),
      }))
      .filter((f) => f.amount !== 0);
    if (value) flows.push({ date: today, amount: value });
    const first = h.trades.reduce<string | null>((m, t) => (!m || t.date < m ? t.date : m), null);
    // Annualising less than a year of returns exaggerates them, so XIRR only
    // once the money has been in for a year.
    const approxDates = h.trades.some((t) => t.approx);
    const rate = !approxDates && first && daysBetween(first, today) >= 365 ? xirr(flows) : null;
    const gain = value !== null ? value - pos.invested : null;
    return {
      ...h,
      quantity: pos.quantity,
      avgCost: pos.avgCost,
      invested: pos.invested,
      value,
      gain,
      gainPct: gain !== null && pos.invested > 0 ? gain / pos.invested : null,
      longTermGain,
      shortTermGain,
      nextLongTerm,
      realizedGain: pos.realizedGain,
      dividends: pos.dividends,
      xirr: rate,
      valueUsd: toUsd(value ?? pos.invested, h.currency, fx),
      investedUsd: toUsd(pos.invested, h.currency, fx),
      weight: 0,
      oversold: pos.oversold,
      realized: pos.realized,
      closed: pos.quantity <= EPS && h.trades.length > 0,
      approxDates,
    };
  });

  const open = rows.filter((r) => !r.closed);
  const valueUsd = open.reduce((s, r) => s + r.valueUsd, 0);
  for (const r of rows) r.weight = valueUsd > 0 && !r.closed ? r.valueUsd / valueUsd : 0;
  const investedUsd = open.reduce((s, r) => s + r.investedUsd, 0);
  const priced = open.filter((r) => r.value !== null);
  const unrealizedUsd = priced.reduce((s, r) => s + toUsd(r.gain!, r.currency, fx), 0);
  const realizedUsd = rows.reduce((s, r) => s + toUsd(r.realizedGain, r.currency, fx), 0);
  const dividendsUsd = rows.reduce((s, r) => s + toUsd(r.dividends, r.currency, fx), 0);

  // Whole-portfolio XIRR, in USD at today's rate.
  const allFlows = rows.flatMap((r) =>
    r.trades
      .map((t) => ({
        date: t.date,
        amount: toUsd(
          t.type === "BUY"
            ? -((t.quantity ?? 0) * (t.price ?? 0) + (t.fees ?? 0))
            : t.type === "SELL"
              ? (t.quantity ?? 0) * (t.price ?? 0) - (t.fees ?? 0)
              : (t.amount ?? 0),
          r.currency,
          fx,
        ),
      }))
      .filter((f) => f.amount !== 0),
  );
  const firstAll = allFlows.reduce<string | null>((m, f) => (!m || f.date < m ? f.date : m), null);
  const portfolioXirr =
    firstAll && daysBetween(firstAll, today) >= 365 && priced.length === open.length && !rows.some((r) => r.approxDates)
      ? xirr([...allFlows, { date: today, amount: valueUsd }]) : null;

  const slice = (keyOf: (r: HoldingRow) => string, labelOf: (k: string) => string): Slice[] => {
    const m = new Map<string, number>();
    for (const r of open) m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + r.valueUsd);
    return [...m.entries()]
      .map(([key, v]) => ({ key, label: labelOf(key), valueUsd: v, weight: valueUsd > 0 ? v / valueUsd : 0 }))
      .sort((a, b) => b.valueUsd - a.valueUsd);
  };
  const byCountry = slice((r) => r.country, (k) => COUNTRY_LABELS[k] ?? k);
  const byAssetType = slice((r) => r.assetType, (k) => ASSET_TYPE_LABELS[k] ?? k);
  const bySector = slice((r) => r.sector?.trim() || "Not set", (k) => k);
  const byAccount = slice((r) => r.accountName, (k) => k);

  // Per country, in its own currency.
  const countries = ["IN", "US", "OTHER"]
    .map((c) => {
      const rs = open.filter((r) => r.country === c);
      if (!rs.length) return null;
      const currency = rs[0].currency;
      const same = rs.every((r) => r.currency === currency);
      const v = rs.reduce((s, r) => s + (same ? (r.value ?? r.invested) : r.valueUsd), 0);
      const inv = rs.reduce((s, r) => s + (same ? r.invested : r.investedUsd), 0);
      return { country: c, currency: same ? currency : "USD", value: v, invested: inv, gain: v - inv, gainPct: inv > 0 ? (v - inv) / inv : null };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  // Gains realized this tax year.
  const fy = indianFyStart(today);
  const year = today.slice(0, 4);
  const realizedIndia = { lt: 0, st: 0, label: `FY ${fy}-${String(fy + 1).slice(2)}` };
  const realizedUs = { lt: 0, st: 0, label: year };
  for (const r of rows) {
    if (r.taxDeferred) continue;
    for (const x of r.realized) {
      if (r.country === "IN" && indianFyStart(x.date) === fy) {
        if (x.longTerm) realizedIndia.lt += x.gain;
        else realizedIndia.st += x.gain;
      } else if (r.country === "US" && x.date.slice(0, 4) === year) {
        if (x.longTerm) realizedUs.lt += x.gain;
        else realizedUs.st += x.gain;
      }
    }
  }

  const insights = buildInsights({ rows: open, all: rows, bySector, byAssetType, byCountry, realizedIndia, today });

  return {
    rows,
    totals: {
      valueUsd,
      valueInr: valueUsd * fx.USDINR,
      investedUsd,
      unrealizedUsd,
      unrealizedPct: investedUsd > 0 ? unrealizedUsd / investedUsd : null,
      realizedUsd,
      dividendsUsd,
      xirr: portfolioXirr,
    },
    countries,
    byCountry,
    byAssetType,
    bySector,
    byAccount,
    realizedIndia,
    realizedUs,
    insights,
  };
}

function buildInsights(a: {
  rows: HoldingRow[];
  all: HoldingRow[];
  bySector: Slice[];
  byAssetType: Slice[];
  byCountry: Slice[];
  realizedIndia: { lt: number; st: number; label: string };
  today: string;
}): Insight[] {
  const out: Insight[] = [];
  const pct = (w: number) => `${Math.round(w * 100)}%`;
  const name = (r: HoldingRow) => r.name || r.symbol;
  if (!a.rows.length) return out;

  for (const r of a.all) {
    if (r.oversold > EPS) out.push({ level: "warn", text: `${name(r)}: more units sold than bought (${+r.oversold.toFixed(4)}). A buy is missing.` });
  }
  const unpriced = a.rows.filter((r) => r.value === null);
  if (unpriced.length) {
    out.push({
      level: "warn",
      text: `No price yet for ${unpriced.map(name).join(", ")}. They're counted at what you paid until a price is fetched or typed in.`,
    });
  }

  // Concentration.
  if (a.rows.length > 1) {
    // Funds and ETFs already spread across many companies.
    // Crypto has its own observation below.
    for (const r of a.rows.filter((x) => x.assetType !== "ETF" && x.assetType !== "MUTUAL_FUND" && x.assetType !== "CRYPTO")) {
      if (r.weight > 0.2) {
        out.push({
          level: "warn",
          text: `${name(r)} is ${pct(r.weight)} of your portfolio. One company's bad news would hit hard; many advisers keep a single stock under 10%.`,
        });
      } else if (r.weight > 0.1 && r.assetType === "STOCK") {
        out.push({ level: "info", text: `${name(r)} is ${pct(r.weight)} of your portfolio, above the usual 10% for one stock.` });
      }
    }
  }
  // Funds already spread across sectors.
  const sector = a.bySector.find((s) => s.key !== "Not set" && s.key !== "Index / Diversified" && s.weight > 0.35);
  if (sector) out.push({ level: "warn", text: `${pct(sector.weight)} is in ${sector.label}. A downturn in that one sector would hit a large part of the portfolio.` });
  const crypto = a.byAssetType.find((s) => s.key === "CRYPTO");
  if (crypto && crypto.weight > 0.1) {
    out.push({ level: "warn", text: `Crypto is ${pct(crypto.weight)} of the portfolio. It can fall 50% or more in a year; keep it to money you can leave untouched.` });
  }
  const diversified = a.byAssetType.filter((s) => s.key === "ETF" || s.key === "MUTUAL_FUND").reduce((s, x) => s + x.weight, 0);
  if (a.rows.length >= 3 && diversified < 0.25) {
    out.push({
      level: "info",
      text: `Only ${pct(diversified)} is in index funds, ETFs or mutual funds. A low-cost index fund (Nifty 50, S&P 500) spreads risk across many companies. If you're a US tax resident, prefer US-listed funds: Indian mutual funds and ETFs are PFICs, taxed heavily in the US.`,
    });
  }
  if (a.byCountry.length > 1) {
    out.push({ level: "info", text: `Split: ${a.byCountry.map((c) => `${c.label} ${pct(c.weight)}`).join(", ")}.` });
  }

  // Tax: lots about to turn long-term, India's yearly LTCG exemption, losses.
  for (const r of a.rows) {
    const n = r.nextLongTerm;
    if (n && n.days <= 60 && n.gain > 0) {
      out.push({
        level: "info",
        text: `${+n.quantity.toFixed(4)} ${r.symbol} turn long-term in ${n.days} day${n.days === 1 ? "" : "s"} (${n.date}). Selling before then taxes the ${fmtMoney(r.currency, n.gain)} gain as short-term.`,
      });
    }
  }
  const indiaLt = a.rows
    .filter((r) => r.country === "IN" && r.assetType !== "CRYPTO" && (r.longTermGain ?? 0) > 0)
    .reduce((s, r) => s + (r.longTermGain ?? 0), 0);
  const room = INDIA_LTCG_EXEMPTION - Math.max(0, a.realizedIndia.lt);
  if (indiaLt > 0 && room > 0) {
    out.push({
      level: "good",
      text: `${a.realizedIndia.label}: up to ${fmtMoney("INR", Math.min(room, indiaLt))} of your ${fmtMoney("INR", indiaLt)} long-term gains on Indian shares and equity funds can be taken tax-free (₹1.25 lakh a year). Selling and buying back before 31 March resets your cost higher ("tax harvesting"). That is Indian tax only: if you're a US tax resident, the US taxes these gains when sold, so harvesting just brings US tax forward.`,
    });
  }
  const usLosses = a.rows.filter((r) => r.country === "US" && !r.taxDeferred && (r.gain ?? 0) < 0).sort((x, y) => x.gain! - y.gain!);
  if (usLosses.length) {
    const total = usLosses.reduce((s, r) => s + r.gain!, 0);
    out.push({
      level: "info",
      text: `US holdings down ${fmtMoney("USD", -total)} (${usLosses
        .slice(0, 3)
        .map((r) => r.symbol)
        .join(", ")}). Selling them before 31 December offsets gains, plus up to $3,000 of income; don't buy the same back within 30 days (wash sale).`,
    });
  }

  const approx = a.rows.filter((r) => r.approxDates);
  if (approx.length) {
    out.push({
      level: "info",
      text: `Buy dates for ${approx.length} holding${approx.length === 1 ? " are" : "s are"} approximate (from a holdings statement), so their yearly return isn't shown. Add the real buy dates, or send your broker's tradebook, for exact returns and long-term dates.`,
    });
  }
  const stale = a.rows.filter((r) => r.value !== null && r.priceAt && daysBetween(r.priceAt.slice(0, 10), a.today) > STALE_DAYS);
  if (stale.length) out.push({ level: "info", text: `Prices older than a week: ${stale.map((r) => r.symbol).join(", ")}. Refresh or update them.` });
  return out;
}

// ---------------------------------------------------------------------------
// Track record: how the investing has gone over the years, per country, in
// its own currency -- what went in and came out, the yearly return against
// an index fund, best and worst holdings, sales made too early, IPOs, gains
// taken by tax year, and the lessons that follow.

// Long-run average yearly returns used as the "an index fund would have..."
// yardstick. Assumptions, not actual index data for the period.
export const BENCHMARKS: Record<string, { label: string; rate: number }> = {
  IN: { label: "Nifty 50 index fund", rate: 0.11 },
  US: { label: "S&P 500 index fund", rate: 0.1 },
};

const tradeCash = (t: Trade) =>
  t.type === "BUY"
    ? -((t.quantity ?? 0) * (t.price ?? 0) + (t.fees ?? 0))
    : t.type === "SELL"
      ? (t.quantity ?? 0) * (t.price ?? 0) - (t.fees ?? 0)
      : (t.amount ?? 0);

export type SoldEarly = { symbol: string; name: string | null; quantity: number; soldAt: number; priceNow: number; missed: number };
export type Performer = { symbol: string; name: string | null; xirr: number; gain: number; closed: boolean };

export type CountryRecord = {
  country: string;
  currency: string;
  since: string;
  years: number;
  bought: number;
  sold: number;
  dividends: number;
  value: number;
  net: number; // value + sold + dividends - bought
  xirr: number | null;
  benchmark: { label: string; rate: number; value: number } | null; // what the same money would be worth
  best: Performer[];
  worst: Performer[];
  soldEarly: SoldEarly[];
  missedTotal: number;
  ipo: { count: number; invested: number; value: number; gain: number; symbols: string[] } | null;
  winners: number;
  positions: number;
  realizedByYear: { label: string; gain: number }[];
  lessons: string[];
  approx: boolean; // some dates are stand-ins
};

export function trackRecord(rows: HoldingRow[], today: string): CountryRecord[] {
  const out: CountryRecord[] = [];
  for (const country of ["IN", "US", "OTHER"]) {
    const rs = rows.filter((r) => r.country === country && r.trades.length);
    if (!rs.length) continue;
    const currency = rs[0].currency;
    if (rs.some((r) => r.currency !== currency)) continue; // mixed currencies: no single-currency record
    const trades = rs.flatMap((r) => r.trades);
    const since = trades.map((t) => t.date).sort()[0];
    const years = daysBetween(since, today) / 365;
    const bought = -trades.filter((t) => t.type === "BUY").reduce((x, t) => x + tradeCash(t), 0);
    const sold = trades.filter((t) => t.type === "SELL").reduce((x, t) => x + tradeCash(t), 0);
    const dividends = trades.filter((t) => t.type === "DIVIDEND").reduce((x, t) => x + tradeCash(t), 0);
    const value = rs.filter((r) => !r.closed).reduce((x, r) => x + (r.value ?? r.invested), 0);
    const approx = rs.some((r) => r.approxDates);
    const flows = trades.map((t) => ({ date: t.date, amount: tradeCash(t) })).filter((f) => f.amount !== 0);
    const rate = !approx && years >= 1 && value > 0 ? xirr([...flows, { date: today, amount: value }]) : null;

    // Same money in and out of an index fund growing at the long-run rate.
    const b = BENCHMARKS[country];
    const benchmark =
      b && !approx
        ? { ...b, value: flows.reduce((x, f) => x - f.amount * Math.pow(1 + b.rate, daysBetween(f.date, today) / 365), 0) }
        : null;

    const perf = rs
      .filter((r) => r.xirr !== null)
      .map((r) => ({ symbol: r.symbol, name: r.name, xirr: r.xirr!, gain: (r.gain ?? 0) + r.realizedGain, closed: r.closed }))
      .sort((x, y) => y.xirr - x.xirr);
    const best = perf.filter((p) => p.xirr > 0).slice(0, 3);
    const worst = perf
      .filter((p) => p.xirr < 0)
      .slice(-3)
      .reverse();

    const soldEarly: SoldEarly[] = [];
    for (const r of rs) {
      if (r.price === null) continue;
      const sells = r.trades.filter((t) => t.type === "SELL" && (t.quantity ?? 0) > 0);
      const qty = sells.reduce((x, t) => x + (t.quantity ?? 0), 0);
      if (!qty) continue;
      const proceeds = sells.reduce((x, t) => x + (t.quantity ?? 0) * (t.price ?? 0), 0);
      const missed = qty * r.price - proceeds;
      if (missed > 0 && r.price > (proceeds / qty) * 1.2) {
        soldEarly.push({ symbol: r.symbol, name: r.name, quantity: qty, soldAt: proceeds / qty, priceNow: r.price, missed });
      }
    }
    soldEarly.sort((x, y) => y.missed - x.missed);
    const missedTotal = soldEarly.reduce((x, s) => x + s.missed, 0);

    const ipoRows = rs.filter((r) => r.trades.some((t) => t.type === "BUY" && /\bIPO\b/i.test(t.notes ?? "")));
    const ipo = ipoRows.length
      ? {
          count: ipoRows.length,
          symbols: ipoRows.map((r) => r.symbol),
          invested: ipoRows.reduce((x, r) => x + r.invested, 0),
          value: ipoRows.reduce((x, r) => x + (r.value ?? r.invested), 0),
          gain: ipoRows.reduce((x, r) => x + (r.gain ?? 0) + r.realizedGain, 0),
        }
      : null;

    const winners = rs.filter((r) => (r.closed ? r.realizedGain : (r.gain ?? 0) + r.realizedGain) > 0).length;

    const byYear = new Map<string, number>();
    for (const r of rs.filter((x) => !x.taxDeferred)) {
      for (const x of r.realized) {
        const label = country === "IN" ? `FY ${indianFyStart(x.date)}-${String(indianFyStart(x.date) + 1).slice(2)}` : x.date.slice(0, 4);
        byYear.set(label, (byYear.get(label) ?? 0) + x.gain);
      }
    }
    const realizedByYear = [...byYear.entries()].map(([label, gain]) => ({ label, gain })).sort((x, y) => x.label.localeCompare(y.label));

    const lessons: string[] = [];
    const f = (n: number) => fmtMoney(currency, n);
    if (rate !== null && b && rate < b.rate - 0.03) {
      lessons.push(
        `Picking stocks has returned ${(rate * 100).toFixed(1)}% a year; a ${b.label} averages about ${Math.round(b.rate * 100)}%. Putting new money into an index fund would likely do better with less work.`,
      );
    } else if (rate !== null && b && rate >= b.rate) {
      lessons.push(`At ${(rate * 100).toFixed(1)}% a year you're ahead of a ${b.label} (about ${Math.round(b.rate * 100)}%). Keep the approach that's working.`);
    }
    if (missedTotal > 0 && soldEarly.length) {
      const atLoss = soldEarly.filter((x) => (rs.find((r) => r.symbol === x.symbol)?.realizedGain ?? 0) < 0).map((x) => x.name || x.symbol);
      lessons.push(
        `Sold too early: ${soldEarly
          .slice(0, 3)
          .map((x) => x.name || x.symbol)
          .join(", ")} ${soldEarly.length === 1 ? "is" : "are"} worth ${f(missedTotal)} more today than you sold ${soldEarly.length === 1 ? "it" : "them"} for${
          atLoss.length ? ` (${atLoss.join(", ")} sold at a loss, after a fall)` : ""
        }. Selling a good company after a dip, or to lock in a small gain, has cost the most; deciding in advance why you'd sell helps.`,
      );
    }
    if (ipo && ipo.gain < 0) {
      lessons.push(`IPOs have lost ${f(-ipo.gain)} (${ipoRows.map((r) => r.name || r.symbol).join(", ")}). New listings are priced for the seller; buying after a few quarters of results usually costs less.`);
    }
    const bigLosers = rs.filter((r) => !r.closed && r.gainPct !== null && r.gainPct < -0.4);
    if (bigLosers.length) {
      lessons.push(
        `${bigLosers.map((r) => r.name || r.symbol).join(", ")} ${bigLosers.length === 1 ? "is" : "are"} down over 40%. Decide on each by asking "would I buy it today?", not by what you paid.`,
      );
    }
    if (rs.length >= 8 && winners / rs.length < 0.6) {
      lessons.push(`${winners} of ${rs.length} positions made money. A few big winners are carrying the rest.`);
    }

    out.push({
      country,
      currency,
      since,
      years,
      bought,
      sold,
      dividends,
      value,
      net: value + sold + dividends - bought,
      xirr: rate,
      benchmark,
      best,
      worst,
      soldEarly,
      missedTotal,
      ipo,
      winners,
      positions: rs.length,
      realizedByYear,
      lessons,
      approx,
    });
  }
  return out;
}

// Things to check when investing in India while living (and paying tax) in
// the US. Shown when the household has Indian investments and US accounts.
export function crossBorderChecklist(indiaInvestmentsUsd: number, indiaBankUsd: number | null): { title: string; text: string; urgent?: boolean }[] {
  const total = indiaInvestmentsUsd + (indiaBankUsd ?? 0);
  const fbar =
    total > 10_000
      ? `Your Indian accounts come to about ${fmtMoney("USD", total)}, over $10,000, so an FBAR (FinCEN 114) is due for this year: list every Indian account, filed online with your return (deadline 15 April, automatic extension to 15 October).`
      : `Indian investments are about ${fmtMoney("USD", indiaInvestmentsUsd)}${indiaBankUsd !== null ? ` and Indian bank balances about ${fmtMoney("USD", indiaBankUsd)}` : ""}. If all your Indian accounts together topped $10,000 at any point in the year (highest balances, not year-end), an FBAR is due.`;
  return [
    {
      title: "Demat account type",
      text: "Once you're a non-resident (NRI), Indian rules (FEMA) require a resident demat/trading account to be converted to an NRO one. Ask your broker; most handle it with a form and KYC.",
    },
    { title: "FBAR", text: fbar, urgent: total > 10_000 },
    {
      title: "US tax on Indian gains and dividends",
      text: "As a US tax resident, Indian gains and dividends go on your US return even when India doesn't tax them; Indian tax paid is claimed back as a foreign tax credit (Form 1116). Your US cost is the dollar amount on the day you bought.",
    },
    {
      title: "Funds (PFIC)",
      text: "Indian mutual funds and ETFs are PFICs for US tax: heavy tax and a Form 8621 each. Hold Indian shares directly, or get India exposure through a US-listed fund (e.g. INDA).",
    },
    {
      title: "Form 8938 (FATCA)",
      text: "If foreign financial assets exceed $50,000 at year-end or $75,000 at any time (double for married filing jointly), Form 8938 goes with your return too.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Health check: the handful of ratios an analyst looks at first, each rated
// against common rules of thumb (not rules).

export type HealthStatus = "good" | "watch" | "act";
export type Health = { key: string; label: string; value: string; status: HealthStatus; note: string };

const rate = (v: number, watch: number, act: number, higherIsWorse = true): HealthStatus =>
  higherIsWorse ? (v > act ? "act" : v > watch ? "watch" : "good") : v < act ? "act" : v < watch ? "watch" : "good";

export function healthCheck(a: ReturnType<typeof analyze>, today: string): Health[] {
  const open = a.rows.filter((r) => !r.closed);
  if (!open.length) return [];
  const pct = (w: number) => `${Math.round(w * 100)}%`;
  const out: Health[] = [];

  const singles = open.filter((r) => r.assetType === "STOCK" || r.assetType === "OTHER").sort((x, y) => y.weight - x.weight);
  if (singles.length) {
    const top = singles[0];
    out.push({
      key: "largest",
      label: "Largest single stock",
      value: pct(top.weight),
      status: rate(top.weight, 0.1, 0.2),
      note: `${top.name || top.symbol}. Under 10% keeps one company's bad news small.`,
    });
  }
  // Funds already hold hundreds of companies: concentration is about single stocks.
  const top3 = singles.slice(0, 3);
  if (singles.length > 3) {
    const w = top3.reduce((s, r) => s + r.weight, 0);
    out.push({
      key: "top3",
      label: "Top 3 stocks",
      value: pct(w),
      status: rate(w, 0.4, 0.6),
      note: top3.map((r) => r.name || r.symbol).join(", "),
    });
  }
  const sector = a.bySector.filter((s) => s.key !== "Not set" && s.key !== "Index / Diversified")[0];
  if (sector) {
    out.push({ key: "sector", label: "Largest sector", value: pct(sector.weight), status: rate(sector.weight, 0.25, 0.35), note: sector.label });
  }
  const funds = a.byAssetType.filter((s) => s.key === "ETF" || s.key === "MUTUAL_FUND").reduce((s, x) => s + x.weight, 0);
  out.push({
    key: "funds",
    label: "In funds and ETFs",
    value: pct(funds),
    status: rate(funds, 0.5, 0.2, false),
    note: "Index funds spread risk across hundreds of companies at low cost.",
  });
  const crypto = a.byAssetType.find((s) => s.key === "CRYPTO")?.weight ?? 0;
  out.push({ key: "crypto", label: "Crypto", value: pct(crypto), status: rate(crypto, 0.05, 0.1), note: "Above 5-10% a crash hurts the whole portfolio." });
  const stale = open.filter((r) => r.value === null || !r.priceAt || daysBetween(r.priceAt.slice(0, 10), today) > STALE_DAYS);
  out.push({
    key: "prices",
    label: "Prices up to date",
    value: `${open.length - stale.length} of ${open.length}`,
    status: stale.length === 0 ? "good" : stale.length <= 2 ? "watch" : "act",
    note: stale.length ? `Refresh prices: ${stale.slice(0, 4).map((r) => r.symbol).join(", ")}${stale.length > 4 ? "..." : ""}` : "All refreshed within a week.",
  });
  return out;
}

// Shares that turn long-term within `days` (selling before then is taxed
// as short-term), soonest first.
export function turningLongTerm(rows: HoldingRow[], days = 120) {
  return rows
    .filter((r) => !r.closed && r.nextLongTerm && r.nextLongTerm.days <= days)
    .map((r) => ({ id: r.id, symbol: r.symbol, name: r.name, currency: r.currency, country: r.country, ...r.nextLongTerm! }))
    .sort((x, y) => x.days - y.days);
}
