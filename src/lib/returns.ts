// Returns and refunds: purchases being sent back, the refund each is waiting
// for, and return windows about to close. Pure -- src/lib/returnsData.ts
// gathers the inputs and saves the pairings.
//
// A return is paired with a refund credit automatically: a credit (a
// refund, or money back on the card) no earlier than the purchase, not
// already paired with another return, for no more than the refund expected,
// and either from the same merchant or for exactly the amount expected --
// on the same card or account, or (merchant and amount both matching) on
// another one.

import { merchantOf } from "@/lib/recurringDetect";

// A refund not seen this many days after sending the item back is late.
export const LATE_DAYS = 14;
// Warn this many days before a return window closes.
export const WINDOW_WARN_DAYS = 5;
// A refund this much under what was expected is short, not rounding.
const SHORT_BY = 0.01;

export type ReturnTxn = {
  id: string;
  date: string; // YYYY-MM-DD, the purchase
  notes: string | null;
  amount: number;
  currency: string;
  instrumentId: string;
  instrumentName: string;
  returnBy: string | null;
  returnState: "RETURNING" | "REFUNDED" | "KEPT" | null;
  returnSentOn: string | null;
  returnExpected: number | null;
  refundTxnId: string | null;
};
export type Credit = { id: string; date: string; notes: string | null; amount: number; currency: string; instrumentId: string };

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const cents = (n: number) => Math.round(n * 100);

// New pairings for the returns still waiting: { returnId, refundId }.
export function matchRefunds(returns: ReturnTxn[], credits: Credit[]): { returnId: string; refundId: string }[] {
  const used = new Set(returns.map((r) => r.refundTxnId).filter((x): x is string => !!x));
  const out: { returnId: string; refundId: string }[] = [];
  const waiting = returns.filter((r) => r.returnState === "RETURNING" && !r.refundTxnId).sort((a, b) => (a.returnSentOn ?? a.date).localeCompare(b.returnSentOn ?? b.date));
  for (const r of waiting) {
    const expected = r.returnExpected ?? r.amount;
    const merchant = merchantOf(r.notes);
    let best: { c: Credit; score: number } | null = null;
    for (const c of credits) {
      if (used.has(c.id) || c.id === r.id || c.currency !== r.currency || c.date < r.date) continue;
      if (cents(c.amount) > cents(expected) + 1) continue;
      const sameMerchant = !!merchant && merchantOf(c.notes) === merchant;
      const exact = Math.abs(cents(c.amount) - cents(expected)) <= 1;
      const sameAccount = c.instrumentId === r.instrumentId;
      if (!(sameAccount ? sameMerchant || exact : sameMerchant && exact)) continue;
      const score = (sameMerchant ? 2 : 0) + (exact ? 3 : 0) + (sameAccount ? 2 : 0);
      if (!best || score > best.score || (score === best.score && c.date < best.c.date)) best = { c, score };
    }
    if (best) {
      used.add(best.c.id);
      out.push({ returnId: r.id, refundId: best.c.id });
    }
  }
  return out;
}

export type ReturnStatus =
  | { kind: "WINDOW"; by: string; daysLeft: number } // can still be returned
  | { kind: "WINDOW_SOON"; by: string; daysLeft: number }
  | { kind: "AWAITING"; sentOn: string; days: number; expected: number }
  | { kind: "LATE"; sentOn: string; days: number; expected: number }
  | { kind: "REFUNDED"; on: string; refunded: number; expected: number }
  | { kind: "SHORT"; on: string; refunded: number; expected: number }
  | { kind: "KEPT" }
  | { kind: "WINDOW_PASSED"; by: string };

export function returnStatus(r: ReturnTxn, refund: { date: string; amount: number } | null, today: string): ReturnStatus | null {
  const expected = r.returnExpected ?? r.amount;
  if (r.returnState === "KEPT") return { kind: "KEPT" };
  if (r.returnState === "REFUNDED" && refund) {
    return refund.amount < expected - SHORT_BY ? { kind: "SHORT", on: refund.date, refunded: refund.amount, expected } : { kind: "REFUNDED", on: refund.date, refunded: refund.amount, expected };
  }
  if (r.returnState === "RETURNING") {
    const sentOn = r.returnSentOn ?? r.date;
    const d = Math.max(0, days(sentOn, today));
    return { kind: d >= LATE_DAYS ? "LATE" : "AWAITING", sentOn, days: d, expected };
  }
  if (r.returnBy) {
    const left = days(today, r.returnBy);
    if (left < 0) return { kind: "WINDOW_PASSED", by: r.returnBy };
    return { kind: left <= WINDOW_WARN_DAYS ? "WINDOW_SOON" : "WINDOW", by: r.returnBy, daysLeft: left };
  }
  return null;
}

// What's still owed back: refunds awaited, and the missing part of short ones.
export function refundsOwed(items: { status: ReturnStatus | null }[]): number {
  let n = 0;
  for (const { status: s } of items) {
    if (!s) continue;
    if (s.kind === "AWAITING" || s.kind === "LATE") n += s.expected;
    if (s.kind === "SHORT") n += s.expected - s.refunded;
  }
  return Math.round(n * 100) / 100;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const md = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

// One line about a return, for its row and for Needs attention.
export function returnText(name: string, s: ReturnStatus, money: (n: number) => string): string {
  switch (s.kind) {
    case "WINDOW":
      return `${name}: can be returned until ${md(s.by)}`;
    case "WINDOW_SOON":
      return s.daysLeft === 0 ? `Last day to return ${name} (today)` : `Last chance to return ${name}: by ${md(s.by)} (${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"})`;
    case "WINDOW_PASSED":
      return `${name}: the return window closed ${md(s.by)}`;
    case "AWAITING":
      return `${name}: ${money(s.expected)} refund on its way (sent back ${md(s.sentOn)})`;
    case "LATE":
      return `${name}: ${money(s.expected)} refund not received yet (sent back ${md(s.sentOn)}, ${s.days} days ago)`;
    case "REFUNDED":
      return `${name}: refunded ${money(s.refunded)} on ${md(s.on)}`;
    case "SHORT":
      return `${name}: refunded only ${money(s.refunded)} of ${money(s.expected)} on ${md(s.on)}`;
    case "KEPT":
      return `${name}: kept`;
  }
}
