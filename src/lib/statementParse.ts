// Finds transactions in the text lines of a bank or card statement (read out
// of a PDF). A transaction line starts with a date and ends with an amount:
//   "11/03/2026  COSTCO WHSE #1234  23.96"
//   "03 Nov 26   SWIGGY BANGALORE   450.00"
//   "Nov 3       PAYMENT - THANK YOU   -1,200.00"
// Bank-account statements often end each line with a running balance too
//   "03/11/2026  ATM WDL  500.00  12,345.67"
// -- when most lines carry two amounts, the last is taken as the balance and
// its change tells money in from money out.

export type StatementRow = {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // always positive
  isCredit: boolean; // payment/refund/deposit -- money in
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?";

// Dates a line can start with (optionally after a short serial number).
const NUMERIC_DATE = /^(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{2,4}))?\b/;
const DAY_MONTH = new RegExp(`^(\\d{1,2})[\\s-]${MONTH}(?:[\\s,-]+(\\d{2,4}))?\\b`, "i");
const MONTH_DAY = new RegExp(`^${MONTH}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, "i");
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})\b/;

// A money amount: needs two decimals so reference numbers and card digits
// aren't mistaken for amounts. Optional sign, brackets, currency mark and
// Cr/Dr suffix.
const MONEY = /(-|\()?\s?(?:[$₹€£]|rs\.?|inr|usd)?\s?(\d{1,3}(?:,\d{2,3})+|\d+)\.(\d{2})\)?(?:\s?(cr|dr)\b)?/gi;

const SKIP = /\b(opening|closing|previous|new|total|available|minimum|statement)\s+(balance|due|amount|payment|credit|limit)|\bbalance\s+(b\/f|c\/f|forward|brought|carried)|\btotal\b/i;
const CREDIT_WORDS = /\b(payment|thank you|refund|reversal|reversed|cashback|credit|deposit|salary|interest earned)\b/i;

type Raw = { y: number | null; a: number; b: number; sep?: string; description: string; amounts: { value: number; negative: boolean; cr: boolean; dr: boolean }[] };

function monthNumber(word: string) {
  const w = word.toLowerCase().replace(/\.$/, "");
  return MONTHS[w.startsWith("sept") ? "sept" : w.slice(0, 3)] ?? 0;
}

function matchDate(text: string): { parts: Omit<Raw, "description" | "amounts">; rest: string } | null {
  let m = text.match(ISO_DATE);
  if (m) return { parts: { y: Number(m[1]), a: Number(m[2]), b: Number(m[3]) }, rest: text.slice(m[0].length) };
  m = text.match(DAY_MONTH);
  if (m) return { parts: { y: m[3] ? Number(m[3]) : null, a: monthNumber(m[2]), b: Number(m[1]) }, rest: text.slice(m[0].length) };
  m = text.match(MONTH_DAY);
  if (m) return { parts: { y: m[3] ? Number(m[3]) : null, a: monthNumber(m[1]), b: Number(m[2]) }, rest: text.slice(m[0].length) };
  m = text.match(NUMERIC_DATE);
  // "12.05" with no year is far more likely an amount than a date.
  if (m && !(m[2] === "." && !m[4])) {
    // Named-month forms are already (month, day); numeric ones are resolved
    // later, once the whole file shows whether it's day- or month-first.
    return { parts: { y: m[4] ? Number(m[4]) : null, a: -Number(m[1]), b: Number(m[3]), sep: m[2] }, rest: text.slice(m[0].length) };
  }
  return null;
}

// The date a line starts with -- or, failing that, the date after a short
// serial number ("12  03/11/2026  ...").
function readDate(line: string) {
  const direct = matchDate(line);
  if (direct) return direct;
  const serial = line.match(/^\d{1,4}\s+/);
  return serial ? matchDate(line.slice(serial[0].length)) : null;
}

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseStatementLines(
  lines: string[],
  opts: { monthFirstByDefault: boolean; today: Date }
): StatementRow[] {
  const raws: Raw[] = [];
  for (const original of lines) {
    const line = original.replace(/\s+/g, " ").trim();
    if (line.length < 8 || SKIP.test(line)) continue;
    const dated = readDate(line);
    if (!dated) continue;
    // A second date right after the first (transaction date + posting date).
    let rest = dated.rest.trim();
    const second = readDate(rest);
    if (second && rest.length - second.rest.length <= 12) rest = second.rest.trim();

    const amounts: Raw["amounts"] = [];
    let firstAmountAt = -1;
    for (const mm of rest.matchAll(MONEY)) {
      // Only amounts in the trailing part of the line count -- a number in
      // the middle of a description ("STORE 12.50 OFF") is left alone by
      // requiring nothing but amounts after the first one we keep.
      const after = rest.slice((mm.index ?? 0) + mm[0].length);
      if (/[a-z]{3,}/i.test(after.replace(/\b(cr|dr)\b/gi, ""))) continue;
      if (firstAmountAt < 0) firstAmountAt = mm.index ?? 0;
      const sign = mm[1];
      amounts.push({
        value: Number(`${mm[2].replace(/,/g, "")}.${mm[3]}`),
        negative: sign === "-" || sign === "(",
        cr: (mm[4] ?? "").toLowerCase() === "cr",
        dr: (mm[4] ?? "").toLowerCase() === "dr",
      });
    }
    if (amounts.length === 0) continue;
    const description = rest.slice(0, firstAmountAt).replace(/[\s|:-]+$/, "").trim();
    if (!description) continue;
    raws.push({ ...dated.parts, description, amounts });
  }
  if (raws.length === 0) return [];

  // Day-first or month-first for numeric dates: a part above 12 settles it.
  // Otherwise the separator is the best hint -- US statements write
  // 11/02/2026, while day-first ones mostly use 02-11-2026 or 02.11.2026 --
  // and only then the account's currency.
  const numeric = raws.filter((r) => r.a < 0);
  const dashOrDot = numeric.filter((r) => r.sep === "-" || r.sep === ".").length;
  const dayFirst = numeric.some((r) => -r.a > 12)
    ? true
    : numeric.some((r) => r.b > 12)
      ? false
      : numeric.length > 0 && dashOrDot > numeric.length / 2
        ? true
        : !opts.monthFirstByDefault;

  // Running-balance statements: most lines end in two amounts.
  const balanceMode = raws.filter((r) => r.amounts.length >= 2).length > raws.length / 2;

  const todayIso = iso(opts.today.getFullYear(), opts.today.getMonth() + 1, opts.today.getDate());
  const rows: StatementRow[] = [];
  let prevBalance: number | null = null;
  for (const r of raws) {
    const [month, day] = r.a < 0 ? (dayFirst ? [r.b, -r.a] : [-r.a, r.b]) : [r.a, r.b];
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let year = r.y === null ? opts.today.getFullYear() : r.y < 100 ? 2000 + r.y : r.y;
    // No year on the statement line: a date "in the future" is last year's.
    if (r.y === null && iso(year, month, day) > todayIso) year -= 1;

    let amount: { value: number; negative: boolean; cr: boolean; dr: boolean };
    let isCredit: boolean;
    if (balanceMode && r.amounts.length >= 2) {
      amount = r.amounts[r.amounts.length - 2];
      const balance = r.amounts[r.amounts.length - 1];
      const balanceValue = balance.negative || balance.dr ? -balance.value : balance.value;
      isCredit =
        prevBalance !== null
          ? balanceValue > prevBalance
          : amount.cr || amount.negative || CREDIT_WORDS.test(r.description);
      prevBalance = balanceValue;
    } else {
      amount = r.amounts[r.amounts.length - 1];
      isCredit = amount.cr || amount.negative || (!amount.dr && CREDIT_WORDS.test(r.description));
    }
    if (!(amount.value > 0)) continue;
    rows.push({ date: iso(year, month, day), description: r.description.slice(0, 200), amount: amount.value, isCredit });
  }
  return rows;
}
