// Finds recurring payments (rent, loan EMIs, phone, subscriptions, regular
// investments) in transaction history, and works out how much of each
// paycheck to set aside for them. Pure: no React, no Prisma.
//
// How:
// 1. Group payments that look like the same bill. Bills and debt payments
//    group by category (their descriptions vary: "Abberly", "House Rent and
//    Water Bill", blank...); everything else by merchant. Within a group,
//    clearly different amounts are different streams (Costco membership vs
//    Costco groceries).
// 2. Stitch together streams that are the same payment recorded under
//    different categories over time (rent under "Home", later
//    "Rent/Mortgage"): similar amount, one ends before the other starts.
// 3. Keep streams that repeat on a recognisable schedule, and project the
//    next payment from the last one.

import { merchantKeys } from "@/lib/merchantKey";
import type { CategoryKind } from "@/lib/categoryKind";

export type HistoryTxn = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  usd: number;
  notes: string | null;
  categoryId: string;
  categoryName: string;
  kind: CategoryKind;
  instrumentName: string;
};

export type Frequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Every 3 months",
  HALF_YEARLY: "Every 6 months",
  YEARLY: "Yearly",
};

// Typical gap in days, and the range of median gaps that counts as it.
const FREQUENCIES: { f: Frequency; days: number; min: number; max: number }[] = [
  { f: "WEEKLY", days: 7, min: 6, max: 9 },
  { f: "BIWEEKLY", days: 14, min: 12, max: 17 },
  { f: "MONTHLY", days: 30.44, min: 25, max: 38 },
  { f: "QUARTERLY", days: 91.3, min: 80, max: 100 },
  { f: "HALF_YEARLY", days: 182.6, min: 165, max: 200 },
  { f: "YEARLY", days: 365.25, min: 340, max: 390 },
];

export type Status = "ACTIVE" | "LATE" | "STOPPED";

export type RecurringBill = {
  key: string;
  label: string;
  kind: CategoryKind; // of the most recent payment
  categoryName: string;
  instrumentName: string;
  currency: string;
  frequency: Frequency;
  intervalDays: number;
  amount: number; // typical recent amount, in `currency`
  usd: number;
  previousAmount: number | null; // set when the amount recently changed noticeably
  count: number;
  firstDate: string;
  lastDate: string;
  nextDate: string; // projected from the last payment
  status: Status;
  perPaycheckUsd: number; // to set aside from each 14-day paycheck
  perMonthUsd: number;
  transactionIds: string[];
};

// Same amount charged again and again within days -- worth a look.
export type FrequentCharge = { key: string; label: string; amount: number; currency: string; count: number; firstDate: string; lastDate: string };

const DAY = 86_400_000;
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const gapDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);
const addDays = (d: string, n: number) => new Date(toUtc(d) + Math.round(n) * DAY).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const AMOUNT_TOLERANCE = 0.15; // within a merchant, amounts this close are one stream
const BILL_AMOUNT_TOLERANCE = 0.4; // (bills vary more: electricity in summer)
const STITCH_TOLERANCE = 0.02; // bills this close in amount can be one payment...
const PRICE_CHANGE_TOLERANCE = 0.3; // ...or, for the same merchant, after a price change
const MAX_STITCH_GAP_DAYS = 100; // ...if one picks up within this long after the other
const MAX_SAME_MERCHANT_GAP_DAYS = 130; // (longer for the same merchant: a few unrecorded months)
// Descriptions that read like a bill, whatever category they were filed under.
const BILL_WORDS = /\bbill\b|rent|internet|mobile|wireless|phone|electric|energy|utilit|water bill|insurance|\bloan\b|\bemi\b|mortgage|tuition|class fee/i;
// One company, several names.
const MERCHANT_ALIASES: Record<string, string> = { COMCAST: "XFINITY", DOMINIONS: "DOMINION", JPMORGAN: "CHASE", PASS: "EZPASS", EZPASSVA: "EZPASS" };
// Everyday purchases that repeat (groceries, takeaway, fuel) aren't bills.
const NOT_BILLS = /food|grocer|dining|restaurant|takeout|fuel|\bgas\b|shopping|snack|coffee/i;
// Long-schedule payments worth trusting after only two occurrences.
const PERIODIC_WORDS = /insurance|tax|membership|subscription|premium|renewal|registration|license|licence/i;

type Stream = { key: string; groupLabel: string; txns: HistoryTxn[] };
const baseKey = (k: string) => k.split("#")[0];

function isBillLike(kind: CategoryKind) {
  return kind === "BILL" || kind === "DEBT_PAYMENT";
}

// The merchant of a description. Entries typed as "what — where" (e.g. "Car
// Insurance — Progressive") name the merchant after the dash.
export function merchantOf(notes: string | null): string | null {
  if (!notes) return null;
  // How it was paid isn't who it was paid to: "Zelle to Dana", "PayPal - Apple.com".
  const cleaned = notes.replace(/^\s*(zelle|venmo|paypal|cash ?app)\s*(to|-|\*)?\s*/i, "");
  const parts = cleaned.split(/\s+[—–]\s+/);
  let keys = parts.length > 1 ? merchantKeys(parts[parts.length - 1]) : [];
  if (keys.length === 0) keys = merchantKeys(parts[0]);
  if (keys.length === 0) return null;
  const main = keys[keys.length - 1];
  return MERCHANT_ALIASES[main] ?? main;
}

// Payments group by merchant, whatever category they were filed under (the
// phone bill under "Home", later "Utilities"). Bills without a description
// group by category; other rows without one can't be told apart.
function groupOf(t: HistoryTxn): { key: string; label: string } | null {
  const merchant = merchantOf(t.notes);
  if (merchant) return { key: `m:${merchant}`, label: titleCase(merchant) };
  return isBillLike(t.kind) ? { key: `cat:${t.categoryId}`, label: t.categoryName } : null;
}

function looksLikeBill(txns: HistoryTxn[]) {
  return txns.some((t) => isBillLike(t.kind) || BILL_WORDS.test(`${t.notes ?? ""} ${t.categoryName}`));
}

// Split a merchant group into streams of similar amounts. Bills get a much
// looser range -- a utility bill varies month to month but is still one bill
// -- that still keeps a one-off (a phone bought from the phone company, a car
// service filed next to the car loan) out of the bill.
function splitByAmount(key: string, label: string, txns: HistoryTxn[]): Stream[] {
  const tolerance = looksLikeBill(txns) ? BILL_AMOUNT_TOLERANCE : AMOUNT_TOLERANCE;
  const sorted = [...txns].sort((a, b) => a.amount - b.amount);
  const clusters: HistoryTxn[][] = [];
  for (const t of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && t.currency === c[0].currency && Math.abs(t.amount - median(c.map((x) => x.amount))) <= tolerance * t.amount) c.push(t);
    else clusters.push([t]);
  }
  return clusters.map((c, i) => ({ key: `${key}#${i}`, groupLabel: label, txns: c.sort((a, b) => a.date.localeCompare(b.date)) }));
}

// Join streams that are one payment recorded in pieces: the same merchant
// after a price change, or one bill whose description changed ("Car Loan —
// Chase", "JPMorgan Chase - Ext Trnsfr", "Car account"). The pieces must fit
// into each other's gaps rather than overlap, and -- unless it's the same
// merchant -- be bills in a shared category at almost the same amount, so
// a $700 room stay never joins a $722 car loan.
function canJoin(a: Stream, b: Stream): boolean {
  if (a.txns[0].currency !== b.txns[0].currency) return false;
  const sameMerchant = a.key.split("+").some((k) => b.key.split("+").some((l) => baseKey(k) === baseKey(l)));
  const amtA = median(a.txns.map((t) => t.amount));
  const amtB = median(b.txns.map((t) => t.amount));
  const diff = Math.abs(amtA - amtB) / Math.max(amtA, amtB);
  if (sameMerchant) {
    // A price change: one run of payments ends, the other begins. (Any change
    // for a bill: electricity in summer vs winter.)
    if (diff > PRICE_CHANGE_TOLERANCE && !(looksLikeBill(a.txns) && looksLikeBill(b.txns))) return false;
    const [first, second] = a.txns[0].date <= b.txns[0].date ? [a, b] : [b, a];
    const gap = gapDays(first.txns[first.txns.length - 1].date, second.txns[0].date);
    return gap >= 15 && gap <= MAX_SAME_MERCHANT_GAP_DAYS;
  }
  if (diff > STITCH_TOLERANCE) return false;
  if (!a.txns.some((t) => isBillLike(t.kind)) || !b.txns.some((t) => isBillLike(t.kind))) return false;
  const catsA = new Set(a.txns.map((t) => t.categoryId));
  if (!b.txns.some((t) => catsA.has(t.categoryId))) return false;
  // Interleave without clashing: no two payments within 15 days of each other.
  if (!a.txns.every((x) => b.txns.every((y) => Math.abs(gapDays(x.date, y.date)) >= 15))) return false;
  // ...and close enough in time to be one schedule.
  const lastA = a.txns[a.txns.length - 1].date;
  const lastB = b.txns[b.txns.length - 1].date;
  const gap = Math.min(...a.txns.flatMap((x) => b.txns.map((y) => Math.abs(gapDays(x.date, y.date)))));
  return gap <= MAX_STITCH_GAP_DAYS && !!lastA && !!lastB;
}

function stitch(streams: Stream[]): Stream[] {
  const out = [...streams];
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (!canJoin(out[i], out[j])) continue;
        const [a, b] = out[i].txns.length >= out[j].txns.length ? [out[i], out[j]] : [out[j], out[i]];
        out[i] = { key: `${a.key}+${b.key}`, groupLabel: a.groupLabel, txns: [...a.txns, ...b.txns].sort((x, y) => x.date.localeCompare(y.date)) };
        out.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return out;
}

function frequencyOf(medianGap: number) {
  return FREQUENCIES.find((f) => medianGap >= f.min && medianGap <= f.max) ?? null;
}

function describe(s: Stream): string {
  // A merchant name for merchant groups; for bills, the category plus the
  // most common merchant in the descriptions when there is one.
  if (s.key.startsWith("m:")) return s.groupLabel;
  const counts = new Map<string, number>();
  for (const t of s.txns) {
    const k = merchantKeys(t.notes);
    if (k.length) counts.set(k[k.length - 1], (counts.get(k[k.length - 1]) ?? 0) + 1);
  }
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  const last = s.txns[s.txns.length - 1];
  return top && top[1] >= 2 ? `${last.categoryName} · ${titleCase(top[0])}` : last.categoryName;
}

export function detectRecurring(history: HistoryTxn[], today: string): { bills: RecurringBill[]; frequent: FrequentCharge[] } {
  const relevant = history.filter((t) => isBillLike(t.kind) || t.kind === "SPENDING" || t.kind === "SAVINGS");
  const groups = new Map<string, { label: string; txns: HistoryTxn[] }>();
  for (const t of relevant) {
    const g = groupOf(t);
    if (!g) continue;
    const entry = groups.get(g.key) ?? { label: g.label, txns: [] };
    entry.txns.push(t);
    groups.set(g.key, entry);
  }
  const streams = stitch(Array.from(groups.entries()).flatMap(([key, g]) => splitByAmount(key, g.label, g.txns)));

  const bills: RecurringBill[] = [];
  const frequent: FrequentCharge[] = [];
  for (const s of streams) {
    // Several payments on one day count once (split or duplicate entries).
    const days = Array.from(new Set(s.txns.map((t) => t.date))).sort();
    if (days.length < 2) continue;
    const gaps = days.slice(1).map((d, i) => gapDays(days[i], d));
    const medGap = median(gaps);
    const last = s.txns[s.txns.length - 1];

    const amounts = s.txns.map((t) => t.amount);
    const spread = (Math.max(...amounts) - Math.min(...amounts)) / Math.max(...amounts);
    if (medGap < 6) {
      // The identical amount, again and again within days.
      if (s.txns.length >= 5 && spread <= 0.01 && s.key.startsWith("m:"))
        frequent.push({ key: s.key, label: s.groupLabel, amount: round2(median(s.txns.map((t) => t.amount))), currency: last.currency, count: s.txns.length, firstDate: days[0], lastDate: last.date });
      continue;
    }
    const freq = frequencyOf(medGap);
    if (!freq) continue;
    const text = s.txns.map((t) => `${t.notes ?? ""} ${t.categoryName}`).join(" ");
    // Repeated everyday purchases (groceries, takeaway, fuel) aren't bills...
    if (!s.txns.some((t) => isBillLike(t.kind)) && NOT_BILLS.test(last.categoryName)) continue;
    // ...and a subscription costs much the same each time.
    if (!looksLikeBill(s.txns) && spread > (PERIODIC_WORDS.test(text) ? 0.3 : 0.1)) continue;
    // Enough repeats to believe it: 3 payments; 2 for a long schedule that
    // reads like insurance, tax or a membership (car insurance every 6 months).
    if (days.length < 3 && !(freq.days >= 80 && PERIODIC_WORDS.test(text))) continue;
    // Mostly on schedule: a missed month (one gap of ~2x) is fine.
    const onSchedule = gaps.filter((g) => Math.abs(g - freq.days) <= freq.days * 0.35 || Math.abs(g - 2 * freq.days) <= freq.days * 0.35).length;
    if (onSchedule / gaps.length < 0.6) continue;

    const recent = amounts.slice(-3);
    const amount = round2(median(s.txns.length >= 3 && Math.abs(amounts[amounts.length - 1] - median(recent)) > 0.1 * median(recent) ? [amounts[amounts.length - 1]] : recent));
    const earlier = amounts.length > 3 ? median(amounts.slice(0, -1)) : null;
    const previousAmount = earlier !== null && Math.abs(amount - earlier) > 0.1 * earlier ? round2(earlier) : null;
    const usdPerUnit = last.usd / last.amount || 1;
    const usd = round2(amount * usdPerUnit);
    const sinceLast = gapDays(last.date, today);
    const status: Status = sinceLast > freq.days * 2.5 ? "STOPPED" : sinceLast > freq.days * 1.4 ? "LATE" : "ACTIVE";
    let nextDate = addDays(last.date, freq.days);
    if (status === "ACTIVE") while (nextDate < today) nextDate = addDays(nextDate, freq.days);
    const counts = status === "STOPPED" ? 0 : 1;

    bills.push({
      key: s.key,
      label: describe(s),
      kind: last.kind,
      categoryName: last.categoryName,
      instrumentName: last.instrumentName,
      currency: last.currency,
      frequency: freq.f,
      intervalDays: freq.days,
      amount,
      usd,
      previousAmount,
      count: s.txns.length,
      firstDate: days[0],
      lastDate: last.date,
      nextDate,
      status,
      perPaycheckUsd: round2((counts * usd * 14) / freq.days),
      perMonthUsd: round2((counts * usd * 30.44) / freq.days),
      transactionIds: s.txns.map((t) => t.id),
    });
  }
  const order: Record<Status, number> = { ACTIVE: 0, LATE: 1, STOPPED: 2 };
  bills.sort((a, b) => order[a.status] - order[b.status] || b.perMonthUsd - a.perMonthUsd || b.usd - a.usd);
  frequent.sort((a, b) => b.count - a.count);
  return { bills, frequent };
}

// Bills expected after today and before the next paycheck (exclusive).
export function dueBefore(bills: RecurringBill[], today: string, nextPayday: string) {
  return bills.filter((b) => b.status !== "STOPPED" && b.nextDate >= today && b.nextDate < nextPayday).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}
