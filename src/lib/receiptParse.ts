// Reads a bill or receipt's text (from on-phone text recognition) into what
// a transaction needs: the amount paid, the date, the store and the currency.
// Pure, so it can be tested alone. Recognition is imperfect -- every field is
// a suggestion the person checks before saving, and any can come back null.

export type ReceiptGuess = {
  amount: number | null;
  currency: "USD" | "INR" | null;
  date: string | null; // YYYY-MM-DD
  merchant: string | null;
  amountLine: string | null; // the line the amount was read from, to show why
};

// Lines that name the amount actually paid, strongest first.
const TOTAL_WORDS: { re: RegExp; score: number }[] = [
  { re: /\bgrand\s*total\b|\btotal\s*(amount\s*)?(due|payable|paid)\b|\bnet\s*(amount|payable|total)\b|\bamount\s*(due|payable|to\s*pay)\b|\bbalance\s*due\b|\bbill\s*amount\b|\btotal\s*bill\b|\bplease\s*pay\b/i, score: 3 },
  { re: /\btotal\b/i, score: 2 },
  { re: /\b(visa|master\s*card|mastercard|amex|discover|debit|credit|card|paid|payment|charged|upi|gpay|phonepe|paytm)\b/i, score: 1 },
];
// Lines that hold money but not the amount paid.
const NOT_TOTAL =
  /sub\s*-?\s*total|\btax(es)?\b|\bvat\b|\b[cs]?gst\b|\bigst\b|\bcess\b|sav(ed|ings?)|\bdiscount\b|\bchange\b|\bcash\s*(tendered|back)\b|\btendered\b|\btip\b|\bgratuity\b|\bpoints?\b|\brewards?\b|\bprevious\s*balance\b|\bminimum\b|\blast\s*payment\b|\bitems?\s*(sold|count)?\b|\bqty\b|\bround(ing|\s*off)\b/i;

const MONEY = /(?:(\$|₹|rs\.?|inr|usd)\s*)?(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d+)(?!\d)/gi;

function amountsIn(line: string): { value: number; marked: boolean; decimals: boolean }[] {
  const out: { value: number; marked: boolean; decimals: boolean }[] = [];
  // OCR reads "12.34" as "12 . 34" or "12,34" sometimes.
  const clean = line.replace(/(\d)\s+\.\s*(\d{2})\b/g, "$1.$2").replace(/(^|[^\d,])(\d+),(\d{2})(?![\d,.])/g, "$1$2.$3");
  for (const m of clean.matchAll(MONEY)) {
    const raw = m[2];
    const decimals = /\.\d{2}$/.test(raw);
    const marked = !!m[1];
    // A bare whole number is a quantity, a store number or a phone fragment.
    if (!decimals && !marked) continue;
    const value = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0 && value < 10_000_000) out.push({ value, marked, decimals });
  }
  return out;
}

function guessCurrency(text: string): "USD" | "INR" | null {
  const inr = (text.match(/₹|\brs\.?\s*\d|\binr\b|\bgstin\b|\bcgst\b|\bsgst\b/gi) ?? []).length;
  const usd = (text.match(/\$|\busd\b/gi) ?? []).length;
  if (inr > usd) return "INR";
  if (usd > 0) return "USD";
  return null;
}

function pickAmount(lines: string[]): { amount: number | null; line: string | null } {
  let best: { score: number; value: number; index: number; line: string } | null = null;
  lines.forEach((line, index) => {
    if (NOT_TOTAL.test(line)) return;
    const word = TOTAL_WORDS.find((w) => w.re.test(line));
    if (!word) return;
    // The amount is on the line, or on the next one when the label sits alone.
    let found = amountsIn(line);
    let used = line;
    if (!found.length && lines[index + 1] && !NOT_TOTAL.test(lines[index + 1])) {
      found = amountsIn(lines[index + 1]);
      used = `${line} ${lines[index + 1]}`;
    }
    if (!found.length) return;
    const value = found[found.length - 1].value; // the right-hand column
    // Stronger label wins; for equal labels the larger amount (TOTAL after a
    // smaller "total savings"-like slip), then the later line.
    if (!best || word.score > best.score || (word.score === best.score && value > best.value)) {
      best = { score: word.score, value, index, line: used.trim() };
    }
  });
  if (best) return { amount: (best as { value: number }).value, line: (best as { line: string }).line };

  // No labelled total: the largest amount with cents or a currency mark.
  let top: { value: number; line: string } | null = null;
  for (const line of lines) {
    if (NOT_TOTAL.test(line)) continue;
    for (const a of amountsIn(line)) if (!top || a.value > top.value) top = { value: a.value, line: line.trim() };
  }
  return top ? { amount: top.value, line: top.line } : { amount: null, line: null };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Every date on a line, in the order found. Numeric dates are month-first in
// dollars and day-first in rupees; a first number over 12 settles it.
function datesIn(line: string, dayFirst: boolean): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const d = validDate(+m[1], +m[2], +m[3]);
    if (d) out.push(d);
  }
  for (const m of line.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g)) {
    const a = +m[1], b = +m[2], y = +m[3];
    const d = a > 12 ? validDate(y, b, a) : b > 12 ? validDate(y, a, b) : dayFirst ? validDate(y, b, a) : validDate(y, a, b);
    if (d) out.push(d);
  }
  // "Nov 5, 2026", "November 05 2026"
  for (const m of line.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|\d{2})\b/gi)) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith("sept") ? 4 : 3)];
    const d = mo ? validDate(+m[3], mo, +m[2]) : null;
    if (d) out.push(d);
  }
  // "05 Nov 2026", "5-Nov-26"
  for (const m of line.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?[\s,-]+(\d{4}|\d{2})\b/gi)) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3)];
    const d = mo ? validDate(+m[3], mo, +m[1]) : null;
    if (d) out.push(d);
  }
  return out;
}

function pickDate(lines: string[], dayFirst: boolean, today: string): string | null {
  const earliest = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
  const candidates: { date: string; score: number; index: number }[] = [];
  lines.forEach((line, index) => {
    for (const date of datesIn(line, dayFirst)) {
      if (date > today || date < earliest) continue; // a due date ahead, or a misread
      const score = /\bdue\b|\bexpir|\bvalid\b|\breturn/i.test(line) ? 0 : /\b(date|dated|bill|invoice|txn|transaction|order|purchase)\b/i.test(line) ? 2 : 1;
      candidates.push({ date, score, index });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.date ?? null;
}

const NOT_MERCHANT =
  /\b(receipt|invoice|tax\s*invoice|bill\s*of\s*supply|welcome|thank|customer|copy|duplicate|store\s*#|st#|tel|phone|ph\.?|mob|fax|gstin|fssai|cin|www\.|http|\.com|date|time|cashier|server|table|order|terminal|register)\b/i;
const ADDRESS = /^\d+\s+\w+.*\b(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|hwy|pkwy|way|ct|plaza|nagar|marg|colony)\b/i;

function tidyName(s: string): string {
  const t = s.replace(/[^A-Za-z0-9&'.\- ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[-.' ]+|[-.' ]+$/g, "");
  // "COSTCO WHOLESALE" -> "Costco Wholesale"; keep mixed case as printed.
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : t;
}

function pickMerchant(lines: string[]): string | null {
  for (const line of lines.slice(0, 6)) {
    const letters = (line.match(/[a-z]/gi) ?? []).length;
    if (letters < 3 || letters < line.replace(/\s/g, "").length * 0.6) continue; // mostly digits or noise
    if (NOT_MERCHANT.test(line) || ADDRESS.test(line)) continue;
    if (amountsIn(line).length) continue;
    const name = tidyName(line);
    if (name.length >= 3) return name.slice(0, 60);
  }
  return null;
}

export function parseReceipt(text: string, today: string): ReceiptGuess {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1);
  const currency = guessCurrency(text);
  const { amount, line } = pickAmount(lines);
  return {
    amount,
    currency,
    date: pickDate(lines, currency === "INR", today),
    merchant: pickMerchant(lines),
    amountLine: line,
  };
}

// When a store has no history yet: what kind of spending the bill looks
// like, as a pattern to find one of the household's own category names.
const KINDS: { bill: RegExp; category: RegExp[] }[] = [
  { bill: /\b(grocer|supermarket|produce|dairy|bananas?|milk|eggs|bread|vegetables?|kirana|mart|harris teeter|kroger|publix|aldi|lidl|safeway|wegmans|whole foods|trader joe|costco|sam'?s club|patel brothers|india bazaar|big ?basket|d-?mart|reliance fresh)\b/i, category: [/grocer/i, /kirana/i, /food/i] },
  { bill: /\b(restaurant|cafe|caf[eé]|coffee|pizza|biryani|burger|grill|kitchen|dine|dining|bar|bistro|tandoor|dosa|masala|starbucks|mcdonald|chipotle|subway|domino|swiggy|zomato|doordash|uber ?eats|grubhub|server|table\s*#?\d|gratuity|tip)\b/i, category: [/dining|restaurant|eat(ing)? out/i, /food/i] },
  { bill: /\b(fuel|gasoline|unleaded|diesel|petrol|gallons?|pump\s*#?\d|shell|exxon|bp|sunoco|wawa|sheetz|chevron|7-?eleven|hp\s*petrol|indian\s*oil|bharat\s*petroleum)\b/i, category: [/\bgas\b|fuel|petrol/i, /transport/i, /\bcar\b/i] },
  { bill: /\b(pharmacy|rx|prescription|cvs|walgreens|rite aid|apollo|medplus|clinic|hospital|doctor|dental|medical|lab)\b/i, category: [/medic|health|pharm|doctor/i] },
  { bill: /\b(electric|power|energy|water|sewer|gas\s*company|internet|broadband|wireless|verizon|t-?mobile|at&t|comcast|xfinity|dominion|airtel|jio|bsnl|kwh)\b/i, category: [/utilit/i, /electric|phone|internet/i, /bill/i] },
  { bill: /\b(target|walmart|amazon|best buy|home depot|lowe'?s|ikea|kohl'?s|macy'?s|old navy|tj ?maxx|marshalls|ross|dollar tree|flipkart|myntra)\b/i, category: [/shopping/i, /household|clothing/i, /home/i] },
];

// Category-name patterns to try, best first, or null when the bill gives no clue.
export function categoryHint(text: string): RegExp[] | null {
  return KINDS.find((k) => k.bill.test(text))?.category ?? null;
}
