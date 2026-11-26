// Turns a raw statement description into merchant keys, so the same
// merchant matches across statements despite card-network noise:
//   "POS 4821 SWIGGY BANGALORE IN"  -> ["SWIGGY BANGALORE", "SWIGGY"]
//   "SWIGGY*ORDER 99812"            -> ["SWIGGY ORDER", "SWIGGY"]
//   "AMZN Mktp US*2K4LM0"           -> ["AMAZON MKTP", "AMAZON"]
// Keys run most specific first; categorization tries them in order.

// Words that describe how a payment was made rather than who it was to.
const NOISE = new Set([
  "POS", "PURCHASE", "PAYMENT", "PAYMENTS", "ONLINE", "DEBIT", "CREDIT", "CARD", "TXN", "REF", "UPI",
  "IMPS", "NEFT", "RTGS", "ACH", "ECOM", "INTL", "INTERNATIONAL", "THE", "INR", "USD", "WWW", "COM",
  "SQ", "TST", "PAYPAL", "VISA", "MASTERCARD", "RUPAY", "AUTOPAY", "RECURRING", "BILL", "TO", "FROM",
  "AND", "OF", "AT", "ON", "IN", "US", "LLC", "INC", "LTD", "PVT", "CO",
]);

// Abbreviations card networks use for common merchants.
const ALIASES: Record<string, string> = {
  AMZN: "AMAZON",
  AMZ: "AMAZON",
  WM: "WALMART",
  WMT: "WALMART",
};

// Short tokens are usually codes or state/country suffixes, not merchants.
const MIN_TOKEN_LENGTH = 3;

export function merchantKeys(description: string | null | undefined): string[] {
  if (!description) return [];
  const tokens = description
    .toUpperCase()
    .split(/[^A-Z]+/)
    .map((t) => ALIASES[t] ?? t)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !NOISE.has(t));
  if (tokens.length === 0) return [];
  const keys = [];
  if (tokens.length >= 2) keys.push(`${tokens[0]} ${tokens[1]}`);
  keys.push(tokens[0]);
  return keys;
}
