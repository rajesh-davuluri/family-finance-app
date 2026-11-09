// Spots the same purchase recorded twice: typed in by hand (or sent from
// Telegram) and later imported from the statement, where the dates often
// differ by a day or two (purchase date vs posting date) and the hand-typed
// one may have no description. Pure: no React, no Prisma.
//
// A possible duplicate needs the same currency and the exact same amount.
// Then, on the same account:
//   HIGH   one typed in (by hand/Telegram) and one from the statement or an
//          alert email, up to a few days apart; or both on the same day
//          with the same description or one with none
//   MEDIUM the same day with different descriptions (two metro trips on one
//          day are often real -- you decide)
// On different accounts: MEDIUM only for the same merchant within a day.
// Repeats on different days from the same kind of source (a daily fare, a
// subscription) are not duplicates.
// Rows from the same statement import are never duplicates of each other:
// the statement lists each charge once.

import { merchantOf } from "@/lib/recurringDetect";

export const DUPLICATE_WINDOW_DAYS = 4;

export type DupTxn = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  instrumentId: string;
  notes: string | null;
  source: string; // MANUAL | IMPORTED | EMAIL | TELEGRAM | RECURRING
  importBatchId?: string | null;
  // Money into the account (income-type category, a deposit). When both
  // sides say, they must agree: $700 in is never a copy of $700 out.
  moneyIn?: boolean;
};

export type Confidence = "HIGH" | "MEDIUM";
export type DupMatch = { id: string; confidence: Confidence; daysApart: number; reason: string };

const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysApart = (a: string, b: string) => Math.abs(Math.round((toUtc(a) - toUtc(b)) / 86_400_000));
const cents = (n: number) => Math.round(Math.abs(n) * 100);
const blank = (s: string | null) => !s || !s.trim();
const fromStatement = (source: string) => source === "IMPORTED" || source === "EMAIL";

// How likely `a` and `b` are one purchase recorded twice; null when not.
export function compare(a: Omit<DupTxn, "id">, b: DupTxn): DupMatch | null {
  if (a.currency !== b.currency || cents(a.amount) !== cents(b.amount)) return null;
  if (a.moneyIn !== undefined && b.moneyIn !== undefined && a.moneyIn !== b.moneyIn) return null;
  const days = daysApart(a.date, b.date);
  if (days > DUPLICATE_WINDOW_DAYS) return null;
  if (a.importBatchId && a.importBatchId === b.importBatchId) return null;

  const ma = merchantOf(a.notes);
  const mb = merchantOf(b.notes);
  const sameMerchant = !!ma && ma === mb;
  const sameNotes = !blank(a.notes) && a.notes!.trim().toLowerCase() === (b.notes ?? "").trim().toLowerCase();
  const oneBlank = blank(a.notes) !== blank(b.notes) || (blank(a.notes) && blank(b.notes));
  const at = days === 0 ? "the same day" : `${days} day${days === 1 ? "" : "s"} apart`;
  const match = (confidence: Confidence, reason: string, question = ""): DupMatch => ({
    id: b.id,
    confidence,
    daysApart: days,
    reason: `${reason}, ${at}${question}`,
  });

  if (a.instrumentId !== b.instrumentId) {
    // Another account: only the same merchant on (almost) the same day.
    return sameMerchant && days <= 1 ? match("MEDIUM", "same amount and merchant on another account") : null;
  }
  // Typed in (by hand or Telegram) and also from the statement or an alert
  // email: the dates often differ by the posting delay. The typed one may
  // have no description; if both name a merchant, they should agree.
  if (fromStatement(a.source) !== fromStatement(b.source)) {
    if (sameMerchant || oneBlank) return match("HIGH", "same amount, entered by hand and also from the statement");
    return days <= 2 ? match("MEDIUM", "same amount, entered by hand and also from the statement", " — different descriptions") : null;
  }
  // Both from the same kind of source: a charge that repeats on different
  // days (a daily metro fare, a subscription) is real, so only the same day
  // counts -- surely so when the description matches or one has none.
  if (days !== 0) return null;
  if (sameNotes) return match("HIGH", "same amount and description");
  if (oneBlank) return match("HIGH", "same amount, one has no description");
  return sameMerchant
    ? match("MEDIUM", "same amount and merchant", " — two purchases?")
    : match("MEDIUM", "same amount on the same account");
}

const rank = (m: DupMatch) => (m.confidence === "HIGH" ? 0 : 1) * 100 + m.daysApart;

// The most likely existing duplicate of a transaction about to be added.
export function findDuplicate(candidate: Omit<DupTxn, "id">, existing: DupTxn[]): DupMatch | null {
  let best: DupMatch | null = null;
  for (const e of existing) {
    const m = compare(candidate, e);
    if (m && (!best || rank(m) < rank(best))) best = m;
  }
  return best;
}

// One-to-one matches for a batch of rows (an import): two identical $4.50
// charges in the file against one existing $4.50 transaction flag only one.
export function matchRows(rows: Omit<DupTxn, "id">[], existing: DupTxn[]): (DupMatch | null)[] {
  const used = new Set<string>();
  return rows.map((r) => {
    const m = findDuplicate(r, existing.filter((e) => !used.has(e.id)));
    if (m) used.add(m.id);
    return m;
  });
}

export type DupPair = { keep: string; remove: string; confidence: Confidence; daysApart: number; reason: string };

// Likely duplicates among transactions already saved. In each pair the one
// to remove is the hand-typed copy when the other came from the statement
// (statement rows are the record of what was charged), else the later-added.
// `skip` leaves out pairs already settled as not duplicates, so another
// real copy of the same transaction can still be found.
export function findPairs(txns: (DupTxn & { createdAt: string })[], skip?: (a: string, b: string) => boolean): DupPair[] {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const pairs: DupPair[] = [];
  const used = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (used.has(a.id)) continue;
    let best: { b: (typeof sorted)[number]; m: DupMatch } | null = null;
    for (let j = i + 1; j < sorted.length && daysApart(a.date, sorted[j].date) <= DUPLICATE_WINDOW_DAYS; j++) {
      const b = sorted[j];
      if (used.has(b.id) || skip?.(a.id, b.id)) continue;
      const m = compare(a, b);
      if (m && (!best || rank(m) < rank(best.m))) best = { b, m };
    }
    if (!best) continue;
    const { b, m } = best;
    used.add(a.id);
    used.add(b.id);
    const removeA = fromStatement(b.source) && !fromStatement(a.source) ? true : fromStatement(a.source) && !fromStatement(b.source) ? false : a.createdAt > b.createdAt;
    pairs.push({ keep: removeA ? b.id : a.id, remove: removeA ? a.id : b.id, confidence: m.confidence, daysApart: m.daysApart, reason: m.reason });
  }
  return pairs.sort((x, y) => (x.confidence === y.confidence ? 0 : x.confidence === "HIGH" ? -1 : 1));
}
