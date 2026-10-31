// Reads a bank's card-transaction alert email ("Rs 450.00 spent on your
// HDFC Bank Credit Card ending 1234 at SWIGGY on 31-10-2026") into the
// pieces needed to record it. Bank wording varies, so this tries several
// common phrasings and returns null when it can't find at least an amount;
// the caller then tells the household rather than guessing.

export type BankAlert = {
  amount: number;
  currency: string | null; // null when the alert doesn't say
  merchant: string | null;
  date: string | null; // YYYY-MM-DD, null when the alert doesn't say
  last4: string | null;
  kind: "DEBIT" | "CREDIT";
};

const CURRENCY_TOKENS: [RegExp, string][] = [
  [/^(?:INR|RS\.?|₹)$/i, "INR"],
  [/^(?:USD|US\$|\$)$/i, "USD"],
  [/^(?:EUR|€)$/i, "EUR"],
  [/^(?:GBP|£)$/i, "GBP"],
];

const AMOUNT = /(INR|Rs\.?|₹|USD|US\$|\$|EUR|€|GBP|£)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function fullYear(y: string) {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

function validDate(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Numeric dates are day-first for Indian/European banks and month-first for
// US ones, so the alert's currency decides how to read 05/10/2026.
function parseDate(text: string, currency: string | null): string | null {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = text.match(/\b(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return validDate(fullYear(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));

  m = text.match(/\b([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return validDate(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));

  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const monthFirst = currency === "USD";
    return monthFirst ? validDate(fullYear(m[3]), a, b) : validDate(fullYear(m[3]), b, a);
  }
  return null;
}

// Where a merchant name ends: the rest of the sentence ("... was made on
// your card ending 1111"), a date, punctuation or the balance line.
const MERCHANT_END =
  "(?=\\s+(?:was|has|is|on\\s+your|card|ending|via|using|with|for|ref|txn|avl)\\b|\\s+on\\s+(?:\\d|[A-Za-z]{3}\\w*\\s+\\d)|[.,;](?:\\s|$)|\\s*$)";

const MERCHANT_PATTERNS = [
  new RegExp("\\bat\\s+(.+?)" + MERCHANT_END, "i"),
  new RegExp("\\btowards\\s+(?:refund\\s+from\\s+)?(.+?)" + MERCHANT_END, "i"),
  new RegExp("\\bInfo:?\\s*(.+?)" + MERCHANT_END, "i"),
  new RegExp("\\bMerchant(?:\\s+Name)?\\s*[:-]\\s*(.+?)" + MERCHANT_END, "i"),
  /\b(?:to|VPA)\s+([A-Za-z0-9@._*&' -]{3,50}?)(?=\s+on\b|[.,;](?:\s|$)|\s+(?:ref|UPI)\b|\s*$)/i,
];

function parseMerchant(text: string): string | null {
  for (const p of MERCHANT_PATTERNS) {
    const m = text.match(p);
    const merchant = m?.[1]?.trim().replace(/\s+/g, " ");
    // Skip captures that are really an amount or a card reference.
    if (merchant && merchant.length >= 2 && !AMOUNT.test(merchant) && !/^(?:your|the)\b/i.test(merchant)) {
      return merchant.slice(0, 80);
    }
  }
  return null;
}

export function parseBankAlert(rawText: string): BankAlert | null {
  const text = rawText.replace(/\s+/g, " ").trim();

  const amountMatch = text.match(AMOUNT);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[2].replace(/,/g, ""));
  if (!(amount > 0)) return null;
  const currency = CURRENCY_TOKENS.find(([re]) => re.test(amountMatch[1]))?.[1] ?? null;

  const isCredit = /\b(credited|refund(?:ed)?|reversal|reversed|cashback)\b/i.test(text);
  const isDebit = /\b(debited|spent|used|charged|purchase|transaction of|paid|withdrawn)\b/i.test(text);

  const last4 = text.match(/(?:ending(?:\s+(?:with|in))?\s*(?:no\.?\s*)?|[xX*]{2,}\s?)(\d{4})\b/)?.[1] ?? null;

  return {
    amount,
    currency,
    merchant: parseMerchant(text),
    date: parseDate(text, currency),
    last4,
    kind: isCredit && !isDebit ? "CREDIT" : "DEBIT",
  };
}

// Inbound email services give HTML-only bodies for many bank alerts.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|li)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8377;|&#x20b9;/gi, "₹")
    .replace(/&[a-z]+;/gi, " ");
}
