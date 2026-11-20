// Lent & borrowed: money between the household and friends or family, by
// person. Pure -- the data and API live in src/lib/personalLoanData.ts and
// /api/lent.
//
// One signed balance per person, in approximate USD: positive means they owe
// you, negative means you owe them. Money out to them (lending, or repaying
// what you borrowed) adds to it; money in from them (borrowing, or them
// repaying you) takes it off. A starting balance covers what was owed before
// the app's records.
// Dates are YYYY-MM-DD.

export const REMIND_AFTER_DAYS = 30;
const EPS = 0.005;

export type LoanEntry = {
  id: string;
  date: string;
  amountUsd: number; // signed: + adds to what they owe you
  label: string; // category name
  notes: string | null;
  account: string;
  countsAsSpending: boolean; // its category counts it as spending or income
};

const r2 = (n: number) => Math.round(n * 100) / 100;

// The balance with a person, and since when it's been owed: the day it last
// went from settled (zero) to owing, or flipped from one side to the other.
export function personBalance(opening: { amountUsd: number; date: string | null }, entries: LoanEntry[]) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let balance = opening.amountUsd;
  let since: string | null = Math.abs(balance) > EPS ? opening.date : null;
  for (const e of sorted) {
    const before = balance;
    balance = r2(balance + e.amountUsd);
    if (Math.abs(balance) <= EPS) since = null;
    else if (Math.abs(before) <= EPS || Math.sign(before) !== Math.sign(balance)) since = e.date;
  }
  balance = Math.abs(balance) <= EPS ? 0 : r2(balance);
  return {
    balanceUsd: balance,
    since: balance === 0 ? null : since,
    lentUsd: r2(sorted.filter((e) => e.amountUsd > 0).reduce((s, e) => s + e.amountUsd, 0)),
    receivedUsd: r2(-sorted.filter((e) => e.amountUsd < 0).reduce((s, e) => s + e.amountUsd, 0)),
  };
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

// Who a transaction is with, read from its note: "Zelle payment to JANARDAN
// BHATT for ...", "Zelle from Sriramkishore Naraharisetti - hand loan",
// "200 paid to Durga". Matches an existing person by full or first name.
export function suggestPerson(notes: string | null, existing: string[]): { name: string; existing: boolean } | null {
  if (!notes) return null;
  const patterns = [
    /zelle\s+(?:payment\s+)?(?:to|from)\s+([a-z][a-z.' -]{1,60}?)(?=\s+(?:for|conf|on|-)\b|\s*[;"\-–]|$)/i,
    /\b(?:paid|lent|given|sent|repaid|returned)\s+(?:back\s+)?to\s+([a-z][a-z.']+(?:\s+[a-z][a-z.']+)?)/i,
    /\b(?:from|borrowed from)\s+([a-z][a-z.']+(?:\s+[a-z][a-z.']+)?)\s*(?:[-–]|$)/i,
  ];
  for (const re of patterns) {
    const m = notes.match(re);
    if (!m) continue;
    const raw = titleCase(m[1].replace(/\s+(for|conf|on)$/i, "").trim());
    if (!raw || /^(me|my|self|the|account|bank)$/i.test(raw)) continue;
    const first = raw.split(" ")[0].toLowerCase();
    const hit = existing.find((n) => n.toLowerCase() === raw.toLowerCase()) ?? existing.find((n) => n.split(/\s+/)[0].toLowerCase() === first);
    return hit ? { name: hit, existing: true } : { name: raw, existing: false };
  }
  return null;
}

// Notes that read like money between people, for transactions not (yet) in a
// loan category.
export const LOAN_NOTE = /\bremaining\b|hand\s*loan|\blent\b|\bborrow|\brepa(id|y)|\bowe[sd]?\b|\bloan\s+(to|from)\b/i;

// A friendly reminder to copy into a message.
export function reminderText(name: string, amountUsd: number, since: string | null): string {
  const first = name.split(/\s+/)[0];
  const amount = `$${Math.abs(amountUsd).toLocaleString("en-US", { minimumFractionDigits: amountUsd % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const when = since ? ` from ${new Date(`${since}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "";
  return `Hi ${first}, just a gentle reminder about the ${amount}${when}. No rush, let me know when it suits you. Thanks!`;
}

export function daysSince(from: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
