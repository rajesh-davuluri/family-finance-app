// Turns the text lines extracted from a credit card statement PDF into
// transaction rows, and reconciles those rows against transactions already
// logged in the app.
//
// Every issuer lays its statement out differently, so parsing is a
// best-effort heuristic rather than a per-bank template: a transaction line
// is any line that STARTS with a date and ENDS with an amount, e.g.
//   "09/15 AMAZON MKTPLACE SEATTLE WA 23.45"            (Chase)
//   "Sep 15 Sep 16 UBER EATS $18.20"                     (Capital One)
//   "09/15/26 09/16/26 SHELL OIL 57442 $41.07"           (Citi / Amex / Discover)
//   "15/09/2026 SWIGGY BANGALORE 1,234.56 Cr"            (HDFC / ICICI, DD/MM)
// Pure functions only -- no React, no Prisma -- so it runs in the browser
// and the person can re-parse instantly after changing the date order.

export type DateOrder = "MDY" | "DMY";

export type StatementRow = {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // always positive
  isCredit: boolean; // payment / refund / credit rather than a purchase
  rawLine: string;
};

export type StatementPeriod = { start: string; end: string };

export type ParseResult = {
  rows: StatementRow[];
  period: StatementPeriod | null;
  dateOrder: DateOrder;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_NAME = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";

// A date at the very start of a line, in any of the shapes listed above.
// A dot separator ("15.09.2026") is only accepted with a year, so an amount
// at the start of a line ("10.05") is never mistaken for a date.
const NUMERIC_DATE = /^(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{2,4}))?(?=\s|$)/;
const DAY_MONTH_NAME = new RegExp(`^(\\d{1,2})[ -]${MONTH_NAME}(?:[ -,]+(\\d{2,4}))?(?=\\s|$)`, "i");
const MONTH_NAME_DAY = new RegExp(`^${MONTH_NAME} (\\d{1,2})(?:,? (\\d{4}))?(?=\\s|$)`, "i");

// Last money amount on a line: optional sign / parentheses / currency
// symbol, digits with any comma grouping (US 1,234.56 or Indian 1,23,456.78),
// exactly two decimals, optional trailing CR/DR or minus.
const AMOUNT = /(-|\()?\s?(?:[$₹€£]|Rs\.?|INR|USD)?\s?(-)?(\d[\d,]*\.\d{2})\)?(?:\s?(CR|Cr|cr|DR|Dr|dr)\b|(-))?/g;

// Summary lines that start with a date and end with an amount but aren't
// transactions.
const NOT_A_TRANSACTION =
  /\b(new balance|previous balance|opening balance|closing balance|minimum (payment|amount) due|payment due|total (amount )?due|credit limit|available credit|statement balance)\b/i;

const PERIOD_HINT = /(period|closing|billing|statement|opening|cycle)/i;

type RawDate = { a: number; b: number; year: number | null; monthKnown: boolean; length: number };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function normalizeYear(y: string | undefined): number | null {
  if (!y) return null;
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

// Reads a date off the start of `text` without deciding yet whether a
// numeric "05/06" is May 6 or 5 June -- that's settled once for the whole
// statement (see detectDateOrder).
function readLeadingDate(text: string): RawDate | null {
  let m = text.match(NUMERIC_DATE);
  if (m && !(m[2] === "." && !m[4])) {
    return { a: Number(m[1]), b: Number(m[3]), year: normalizeYear(m[4]), monthKnown: false, length: m[0].length };
  }
  m = text.match(DAY_MONTH_NAME);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return { a: month, b: Number(m[1]), year: normalizeYear(m[3]), monthKnown: true, length: m[0].length };
  }
  m = text.match(MONTH_NAME_DAY);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return { a: month, b: Number(m[2]), year: normalizeYear(m[3]), monthKnown: true, length: m[0].length };
  }
  return null;
}

function monthDay(d: RawDate, order: DateOrder): { month: number; day: number } {
  if (d.monthKnown) return { month: d.a, day: d.b };
  return order === "MDY" ? { month: d.a, day: d.b } : { month: d.b, day: d.a };
}

function isValidMonthDay(month: number, day: number) {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

// Statements without a year on each line ("09/15") only make sense relative
// to the statement's closing date: a December line on a January statement
// belongs to the previous year.
function resolveYear(month: number, explicit: number | null, reference: Date): number {
  if (explicit) return explicit;
  const refYear = reference.getUTCFullYear();
  return month > reference.getUTCMonth() + 1 ? refYear - 1 : refYear;
}

function toIso(d: RawDate, order: DateOrder, reference: Date): string | null {
  const { month, day } = monthDay(d, order);
  if (!isValidMonthDay(month, day)) return null;
  return `${resolveYear(month, d.year, reference)}-${pad(month)}-${pad(day)}`;
}

// Any value above 12 in the first position means day-first; above 12 in the
// second means month-first. Otherwise fall back to the caller's default
// (USD cards are almost always MM/DD, INR/GBP/EUR cards DD/MM).
export function detectDateOrder(lines: string[], fallback: DateOrder): DateOrder {
  let dayFirstVotes = 0;
  let monthFirstVotes = 0;
  for (const line of lines) {
    const d = readLeadingDate(line.trim());
    if (!d || d.monthKnown) continue;
    if (d.a > 12 && d.b <= 12) dayFirstVotes++;
    if (d.b > 12 && d.a <= 12) monthFirstVotes++;
  }
  if (dayFirstVotes > monthFirstVotes) return "DMY";
  if (monthFirstVotes > dayFirstVotes) return "MDY";
  return fallback;
}

// Finds every date anywhere in a line (not just at the start) -- used to
// spot the statement period, which is usually printed mid-line, e.g.
// "Opening/Closing Date 08/15/26 - 09/14/26".
function findAllDates(line: string): RawDate[] {
  const found: RawDate[] = [];
  // Space out ranges written without gaps ("08/15/26-09/14/26").
  const spaced = line.replace(/[–—]/g, " - ").replace(/(\d)-(\d{1,2}\/)/g, "$1 - $2");
  const tokens = spaced.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const rest = tokens.slice(i).join(" ");
    const d = readLeadingDate(rest);
    if (d && d.year) found.push(d);
  }
  return found;
}

export function detectPeriod(lines: string[], order: DateOrder): StatementPeriod | null {
  const reference = new Date();
  for (const line of lines) {
    if (!PERIOD_HINT.test(line)) continue;
    const dates = findAllDates(line);
    if (dates.length < 2) continue;
    const start = toIso(dates[0], order, reference);
    const end = toIso(dates[1], order, reference);
    if (start && end && start <= end) return { start, end };
  }
  return null;
}

function parseAmount(line: string): { amount: number; isCredit: boolean; index: number } | null {
  let last: RegExpExecArray | null = null;
  AMOUNT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT.exec(line)) !== null) last = m;
  if (!last) return null;
  const [, leadingSignOrParen, innerMinus, digits, crDr, trailingMinus] = last;
  const amount = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount === 0) return null;
  const isCredit =
    leadingSignOrParen === "-" ||
    leadingSignOrParen === "(" ||
    innerMinus === "-" ||
    trailingMinus === "-" ||
    (crDr ?? "").toUpperCase() === "CR";
  return { amount, isCredit, index: last.index };
}

export function parseStatementLines(
  lines: string[],
  options: { dateOrder?: DateOrder | "auto"; fallbackOrder?: DateOrder } = {}
): ParseResult {
  const fallback = options.fallbackOrder ?? "MDY";
  const dateOrder =
    !options.dateOrder || options.dateOrder === "auto" ? detectDateOrder(lines, fallback) : options.dateOrder;
  const period = detectPeriod(lines, dateOrder);
  const reference = period ? new Date(`${period.end}T00:00:00Z`) : new Date();

  const rows: StatementRow[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/\s+/g, " ");
    const first = readLeadingDate(line);
    if (!first) continue;
    let rest = line.slice(first.length).trim();

    // Many issuers print a transaction date then a posting date; skip the
    // second one so it doesn't end up in the description. The transaction
    // date is the one the person would have entered.
    const second = readLeadingDate(rest);
    if (second) rest = rest.slice(second.length).trim();

    const parsedAmount = parseAmount(rest);
    if (!parsedAmount) continue;
    const description = rest
      .slice(0, parsedAmount.index)
      .replace(/[\s$₹€£-]+$/, "")
      .trim();
    if (!description || NOT_A_TRANSACTION.test(description)) continue;

    const date = toIso(first, dateOrder, reference);
    if (!date) continue;
    rows.push({ date, description, amount: parsedAmount.amount, isCredit: parsedAmount.isCredit, rawLine: line });
  }
  return { rows, period, dateOrder };
}

// ---------------------------------------------------------------------------
// Reconciliation

export type MatchMode = "AMOUNT_AND_DATE" | "AMOUNT_ONLY" | "DATE_ONLY";

export type AppTransaction = { id: string; amount: number; date: string; notes: string | null };

export type Reconciliation = {
  // matches[i] is the app transaction matched to statement row i, or null
  // when that row isn't in the app yet.
  matches: (AppTransaction | null)[];
  unmatchedApp: AppTransaction[];
};

function dayDiff(a: string, b: string) {
  return Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
}

function cents(n: number) {
  return Math.round(n * 100);
}

// One-to-one matching: every candidate pair is scored, then pairs are taken
// closest-first so two identical $5.00 coffees on the statement can't both
// claim the single $5.00 coffee logged in the app.
export function reconcile(
  rows: StatementRow[],
  appTxns: AppTransaction[],
  mode: MatchMode,
  toleranceDays: number
): Reconciliation {
  const pairs: { row: number; txn: number; score: number }[] = [];
  rows.forEach((r, ri) => {
    appTxns.forEach((t, ti) => {
      const sameAmount = cents(r.amount) === cents(Math.abs(t.amount));
      const diff = dayDiff(r.date, t.date);
      if (mode === "AMOUNT_AND_DATE" && sameAmount && diff <= toleranceDays) pairs.push({ row: ri, txn: ti, score: diff });
      if (mode === "AMOUNT_ONLY" && sameAmount) pairs.push({ row: ri, txn: ti, score: diff });
      // Date-only is the loosest check: same day (within tolerance), any
      // amount -- closest amount wins, then closest date.
      if (mode === "DATE_ONLY" && diff <= toleranceDays) {
        pairs.push({ row: ri, txn: ti, score: Math.abs(cents(r.amount) - cents(Math.abs(t.amount))) * 1000 + diff });
      }
    });
  });
  pairs.sort((x, y) => x.score - y.score);

  const matches: (AppTransaction | null)[] = rows.map(() => null);
  const usedTxns = new Set<number>();
  for (const p of pairs) {
    if (matches[p.row] || usedTxns.has(p.txn)) continue;
    matches[p.row] = appTxns[p.txn];
    usedTxns.add(p.txn);
  }
  return { matches, unmatchedApp: appTxns.filter((_, i) => !usedTxns.has(i)) };
}
