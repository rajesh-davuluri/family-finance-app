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

const STOP_WORDS = new Set(["on", "at", "for", "to", "from", "via", "using", "paid", "spent", "card", "the", "a", "rs", "inr"]);

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

export function parseQuickEntry(
  text: string,
  accounts: ParseAccount[],
  categories: ParseCategory[],
  today: Date = new Date()
): QuickDraft | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // A pasted bank alert carries its own amount, card and date.
  const alert = /(?:INR|Rs\.?|₹|USD|\$|EUR|€|GBP|£)\s*\d/i.test(trimmed) && trimmed.length > 40 ? parseBankAlert(trimmed) : null;
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

  // Quick note: one number is the amount; everything else is matched below.
  let rest = ` ${trimmed} `;
  let date = isoDay(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (/\byesterday\b/i.test(rest)) {
    date = isoDay(yesterday);
    rest = rest.replace(/\byesterday\b/gi, " ");
  }
  rest = rest.replace(/\btoday\b/gi, " ");
  const dm = rest.match(/\s(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?=\s)/);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : today.getFullYear();
    const [d, m] = [Number(dm[1]), Number(dm[2])];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    rest = rest.replace(dm[0], " ");
  }

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
