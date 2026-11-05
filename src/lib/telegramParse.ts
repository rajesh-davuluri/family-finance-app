import { parseBankAlert } from "@/lib/bankAlert";

// Reads a message sent to the Telegram bot into a draft transaction. Two
// shapes are understood:
//   - pasted/forwarded bank alerts ("Rs 450 spent on card ending 1234 at
//     SWIGGY on 31-10-2026") -- via the same reader as Gmail alerts
//   - quick notes in any order: "450 swiggy hdfc", "groceries 1200 amex
//     yesterday", "₹99 netflix 30/10"
// Words matching an account (name or last 4) or a category name pick those;
// what's left becomes the description.

export type ParseAccount = { id: string; name: string; last4: string | null; currency: string };
export type ParseCategory = { id: string; name: string };

export type QuickDraft = {
  amount: number;
  currency: string | null;
  date: string; // YYYY-MM-DD
  notes: string | null;
  instrumentId: string | null;
  categoryId: string | null;
  isRefund: boolean;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_NAMES =
  /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)$/;

// Wording that marks a bank alert rather than a quick note or statement line.
const ALERT_WORDS = /\b(spent|debited|credited|charged|purchase|transaction|card ending|ending|avl|available|a\/c)\b/i;

// The most entries one message can hold, to keep a mis-paste from flooding
// the chat with confirmations.
export const MAX_ENTRIES_PER_MESSAGE = 20;

// Splits one Telegram message into separate transactions. Blank-line
// separated blocks are separate; within a block, short lines that each carry
// a number (and no alert wording) are one transaction per line -- e.g. a
// list copied from a card app:
//   ParkX Management: $5.95 on November 4, 2026
//   Costco: $23.96 on November 3, 2026
// A multi-line pasted alert stays one transaction.
export function splitEntries(text: string): string[] {
  const entries: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block
      .split("\n")
      .map((l) => l.trim().replace(/^(?:[-•*]|\d{1,2}[.)])\s+(?=\S)/, ""))
      .filter(Boolean);
    if (lines.length === 0) continue;
    const onePerLine = lines.length > 1 && lines.every((l) => l.length <= 100 && /\d/.test(l) && !ALERT_WORDS.test(l));
    if (onePerLine) entries.push(...lines);
    else entries.push(lines.join(" "));
  }
  return entries;
}

const STOP_WORDS = new Set(["date", "dated", "on", "at", "for", "to", "from", "via", "using", "paid", "spent", "card", "the", "a", "rs", "inr"]);

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function words(s: string) {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Significant words of a name: "HDFC Credit Card" -> ["hdfc"], since
// "credit"/"card" would match every card.
const GENERIC_NAME_WORDS = new Set(["credit", "debit", "card", "bank", "account", "savings", "checking", "current", "cash", "wallet"]);
function nameWords(name: string) {
  return words(name).filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function validDay(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}

// A date written without a year means the most recent such date -- "Dec 30"
// sent on Nov 5 is last December's.
function withYear(month: number, day: number, year: number | null, today: Date): string | null {
  if (year !== null) return validDay(year, month, day) ? ymd(year, month, day) : null;
  let y = today.getFullYear();
  if (!validDay(y, month, day)) return null;
  if (ymd(y, month, day) > isoDay(today)) y -= 1;
  return validDay(y, month, day) ? ymd(y, month, day) : null;
}

function fullYear(y: string | undefined) {
  if (!y) return null;
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

// Finds the date in a quick note and returns the note without it. Handles
// today/yesterday, "2 days ago", weekdays ("monday", "last friday"),
// 2026-11-03, 11/03[/2026] (month-first when asked, unless a part is over
// 12), 11.03.2026, "Nov 3[, 2026]", "3 Nov", "Nov3", "november 3rd" and a
// bare ordinal ("on 3rd" = the 3rd of this month, or last month's).
function extractDate(text: string, today: Date, monthFirst: boolean): { date: string | null; rest: string } {
  const cut = (m: RegExpMatchArray) => text.replace(m[0], " ");
  const shift = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return isoDay(d);
  };
  // Dates may follow a space or a "date:"/"on:" label.
  const B = "(?:^|[\\s:(])";
  const E = "(?=[\\s,.)]|$)";

  let m = text.match(/\byesterday\b/i);
  if (m) return { date: shift(1), rest: cut(m) };
  m = text.match(/\btoday\b/i);
  if (m) return { date: isoDay(today), rest: cut(m) };
  m = text.match(/\b(\d{1,2})\s+days?\s+ago\b/i);
  if (m) return { date: shift(Number(m[1])), rest: cut(m) };
  m = text.match(new RegExp(`\\b(last\\s+)?(${WEEKDAYS.join("|")})\\b`, "i"));
  if (m) {
    const target = WEEKDAYS.indexOf(m[2].toLowerCase());
    let back = (today.getDay() - target + 7) % 7;
    if (m[1] && back === 0) back = 7;
    return { date: shift(back), rest: cut(m) };
  }

  m = text.match(new RegExp(`${B}(\\d{4})-(\\d{1,2})-(\\d{1,2})${E}`));
  if (m && validDay(Number(m[1]), Number(m[2]), Number(m[3]))) {
    return { date: ymd(Number(m[1]), Number(m[2]), Number(m[3])), rest: cut(m) };
  }

  m = text.match(new RegExp(`${B}(\\d{1,2})([/.-])(\\d{1,2})(?:\\2(\\d{2,4}))?${E}`));
  // "12.50" with no year is an amount, not a date.
  if (m && !(m[2] === "." && !m[4])) {
    const [a, b] = [Number(m[1]), Number(m[3])];
    const monthFirstHere = a > 12 ? false : b > 12 ? true : monthFirst;
    const date = withYear(monthFirstHere ? a : b, monthFirstHere ? b : a, fullYear(m[4]), today);
    if (date) return { date, rest: cut(m) };
  }

  // Named months: try "Nov 3", "3 Nov", then the run-together "Nov3"/"3Nov".
  const month = (w: string) => (MONTH_NAMES.test(w.toLowerCase()) ? MONTHS[w.toLowerCase().slice(0, 3)] : undefined);
  const named: [RegExp, (m: RegExpMatchArray) => [string, string, string | undefined]][] = [
    [new RegExp(`${B}([A-Za-z]{3,9})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?${E}`, "g"), (x) => [x[1], x[2], x[3]]],
    [new RegExp(`${B}(\\d{1,2})(?:st|nd|rd|th)?\\s*([A-Za-z]{3,9})\\.?,?(?:\\s+(\\d{4}))?${E}`, "g"), (x) => [x[2], x[1], x[3]]],
  ];
  for (const [re, parts] of named) {
    for (const x of text.matchAll(re)) {
      const [word, day, year] = parts(x);
      const mo = month(word);
      if (!mo) continue; // "market 12" isn't March 12
      const date = withYear(mo, Number(day), year ? Number(year) : null, today);
      if (date) return { date, rest: text.replace(x[0], " ") };
    }
  }

  // A bare ordinal: "on 3rd", "the 21st".
  m = text.match(new RegExp(`${B}(\\d{1,2})(st|nd|rd|th)${E}`, "i"));
  if (m) {
    const day = Number(m[1]);
    let y = today.getFullYear();
    let mo = today.getMonth() + 1;
    if (day > today.getDate()) {
      mo -= 1;
      if (mo === 0) {
        mo = 12;
        y -= 1;
      }
    }
    if (validDay(y, mo, day)) return { date: ymd(y, mo, day), rest: cut(m) };
  }

  return { date: null, rest: text };
}

export function parseQuickEntry(
  text: string,
  accounts: ParseAccount[],
  categories: ParseCategory[],
  today: Date = new Date(),
  // Read 11/03 as Nov 3 (US) rather than 11 March.
  opts: { monthFirst?: boolean } = {}
): QuickDraft | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // A pasted bank alert ("Rs 450 spent on card ending 1234 at ...") carries
  // its own amount, card and date. Statement-style lines like "Costco:
  // $23.96 on November 3, 2026" have no alert wording and go through the
  // quick-note path below, which keeps the merchant name.
  const looksLikeAlert = ALERT_WORDS.test(trimmed) && /(?:INR|Rs\.?|₹|USD|\$|EUR|€|GBP|£)\s*\d/i.test(trimmed);
  const alert = looksLikeAlert ? parseBankAlert(trimmed) : null;
  if (alert) {
    const account = alert.last4 ? accounts.find((a) => a.last4 === alert.last4) : undefined;
    return {
      amount: alert.amount,
      currency: alert.currency,
      date: alert.date ?? isoDay(today),
      notes: alert.merchant,
      instrumentId: account?.id ?? null,
      categoryId: null,
      isRefund: alert.kind === "CREDIT",
    };
  }

  // Quick note: the date (if any) first, then one number is the amount, and
  // everything else is matched below.
  const found = extractDate(` ${trimmed} `, today, opts.monthFirst ?? false);
  const date = found.date ?? isoDay(today);
  let rest = found.rest;

  let currency: string | null = null;
  const am = rest.match(/(?:^|\s)(₹|rs\.?|inr|\$|usd|€|eur|£|gbp)?\s*(\d[\d,]*(?:\.\d{1,2})?)(?=\s)/i);
  if (!am) return null;
  const amount = parseFloat(am[2].replace(/,/g, ""));
  if (!(amount > 0)) return null;
  if (am[1]) {
    const c = am[1].toLowerCase();
    currency = /₹|rs|inr/.test(c) ? "INR" : /\$|usd/.test(c) ? "USD" : /€|eur/.test(c) ? "EUR" : "GBP";
  }
  rest = rest.replace(am[0], " ");

  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  const used = new Set<number>();

  // Account: a 4-digit last4, or a distinctive word of its name.
  let instrumentId: string | null = null;
  tokens.forEach((t, i) => {
    if (instrumentId) return;
    const w = t.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = accounts.find((a) => (a.last4 && w === a.last4) || (w.length >= 3 && nameWords(a.name).includes(w)));
    if (match) {
      instrumentId = match.id;
      used.add(i);
    }
  });

  // Category: a word that starts a category name ("groc" -> Groceries).
  let categoryId: string | null = null;
  tokens.forEach((t, i) => {
    if (categoryId || used.has(i)) return;
    const w = t.toLowerCase().replace(/[^a-z]/g, "");
    if (w.length < 4) return;
    const match = categories.find((c) => words(c.name).some((cw) => cw.startsWith(w)));
    if (match) {
      categoryId = match.id;
      used.add(i);
    }
  });

  const notes = tokens
    .filter((t, i) => !used.has(i) && !STOP_WORDS.has(t.toLowerCase()))
    .join(" ")
    .replace(/[\s:;,\-–—]+$/, "")
    .trim();

  return {
    amount,
    currency,
    date,
    notes: notes || null,
    instrumentId,
    categoryId,
    isRefund: /\b(refund|cashback|reversal)\b/i.test(trimmed),
  };
}
