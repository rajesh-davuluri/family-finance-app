// Credit card statements: what the last statement asked for, how much of it
// has been paid, what's been charged since, and what's owed right now.
// Pure (dates are "YYYY-MM-DD" strings), so it can be tested alone; the API
// route gathers each card's transactions and transfers into CardActivity.
//
// The anchor is a statement: one typed in from the paper statement (exact),
// or, for a cycle that has closed since, the last typed-in balance rolled
// forward through the cycle's payments and charges (exact if every
// transaction is in the app). With no statement typed in at all, the
// statement balance is estimated as the cycle's net charges -- i.e. assuming
// the statement before it was paid in full -- and marked as an estimate.

export type ActivityKind = "CHARGE" | "CREDIT" | "PAYMENT";
export type CardActivity = {
  date: string;
  amount: number; // positive
  kind: ActivityKind;
  source: "CARD" | "TRANSFER"; // logged on the card itself, or a transfer from a bank account
  label: string;
  transferId?: string; // a payment recorded as a transfer, which can be undone
};
export type RecordedStatement = { id: string; closingDate: string; balance: number; minimumDue: number | null; dueDate: string | null };
export type CardInput = {
  statementDay: number | null;
  dueDay: number | null;
  creditLimit: number | null;
  statements: RecordedStatement[];
  activity: CardActivity[];
  today: string;
};

export type CycleSummary = {
  start: string; // exclusive: the previous closing date
  close: string;
  charges: number;
  credits: number;
  payments: number;
  statementBalance: number | null; // typed in for this closing date, if any
};

export type StatementStatus = "NOTHING_DUE" | "PAID" | "DUE" | "OVERDUE";

export type CardSnapshot = {
  hasCycle: boolean; // false until a closing day or a statement is known
  statement: {
    close: string;
    balance: number;
    basis: "RECORDED" | "ROLLED_FORWARD" | "ESTIMATED";
    minimumDue: number | null;
    dueDate: string;
    dueDateApprox: boolean;
    recordedId: string | null;
  } | null;
  paidSinceStatement: number;
  leftOnStatement: number;
  minimumLeft: number | null;
  status: StatementStatus | null;
  daysToDue: number | null; // negative once past due
  chargesSinceStatement: number;
  creditsSinceStatement: number;
  outstanding: number | null; // owed right now; negative = the card owes you
  available: number | null;
  utilization: number | null; // outstanding / limit
  nextClose: string | null;
  nextDue: string | null;
  cycles: CycleSummary[]; // newest first
  duplicatePayments: number; // payments seen both on the card and as a bank transfer, counted once
  recent: CardActivity[]; // since the statement closed, newest first
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.005;

// ---- dates ----------------------------------------------------------------

function parts(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m: m - 1, day };
}
function ymd(y: number, m: number, day: number) {
  const t = new Date(Date.UTC(y, m, day));
  return t.toISOString().slice(0, 10);
}
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
// The given day of a month, or its last day when the month is shorter (a
// statement that closes on the 31st closes on the 30th in November).
function dayOf(y: number, m: number, day: number) {
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return ymd(ny, nm, Math.min(day, daysIn(ny, nm)));
}
export function addDays(d: string, n: number) {
  const { y, m, day } = parts(d);
  return ymd(y, m, day + n);
}
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// The latest closing date on or before `on`.
export function closeOnOrBefore(on: string, statementDay: number) {
  const { y, m } = parts(on);
  const thisMonth = dayOf(y, m, statementDay);
  return thisMonth <= on ? thisMonth : dayOf(y, m - 1, statementDay);
}
export function nextClose(close: string, statementDay: number) {
  const { y, m } = parts(close);
  return dayOf(y, m + 1, statementDay);
}
export function prevClose(close: string, statementDay: number) {
  const { y, m } = parts(close);
  return dayOf(y, m - 1, statementDay);
}
// The first due day after a closing date; about 25 days after it when the
// due day isn't known (the usual grace period).
export function dueAfter(close: string, dueDay: number | null): { date: string; approx: boolean } {
  if (!dueDay) return { date: addDays(close, 25), approx: true };
  const { y, m } = parts(close);
  const same = dayOf(y, m, dueDay);
  return { date: same > close ? same : dayOf(y, m + 1, dueDay), approx: false };
}

// ---- payments seen twice ----------------------------------------------------

// A payment can arrive twice: as a transfer when the bank statement is
// imported ("CITI CARD PAYMENT") and as a credit line when the card's own
// statement is ("PAYMENT - THANK YOU"). Same amount within a week = one
// payment; the bank-side transfer is kept.
export function dedupePayments(activity: CardActivity[]): { activity: CardActivity[]; dropped: number } {
  const transfers = activity.filter((a) => a.kind === "PAYMENT" && a.source === "TRANSFER");
  const used = new Set<CardActivity>();
  const drop = new Set<CardActivity>();
  for (const a of activity) {
    if (a.kind !== "PAYMENT" || a.source !== "CARD") continue;
    const match = transfers
      .filter((t) => !used.has(t) && Math.abs(t.amount - a.amount) < EPS && Math.abs(daysBetween(t.date, a.date)) <= 7)
      .sort((x, y) => Math.abs(daysBetween(x.date, a.date)) - Math.abs(daysBetween(y.date, a.date)))[0];
    if (match) {
      used.add(match);
      drop.add(a);
    }
  }
  return { activity: activity.filter((a) => !drop.has(a)), dropped: drop.size };
}

// ---- the snapshot ------------------------------------------------------------

function sums(activity: CardActivity[], after: string, upTo: string | null) {
  let charges = 0,
    credits = 0,
    payments = 0;
  for (const a of activity) {
    if (a.date <= after || (upTo && a.date > upTo)) continue;
    if (a.kind === "CHARGE") charges += a.amount;
    else if (a.kind === "CREDIT") credits += a.amount;
    else payments += a.amount;
  }
  return { charges: r2(charges), credits: r2(credits), payments: r2(payments) };
}

export function cardSnapshot(input: CardInput): CardSnapshot {
  const { today, creditLimit } = input;
  const { activity, dropped } = dedupePayments(input.activity);
  const recorded = [...input.statements].filter((s) => s.closingDate <= today).sort((a, b) => (a.closingDate < b.closingDate ? 1 : -1));
  const latestRecorded = recorded[0] ?? null;
  // The closing day: as set, else read off the latest typed-in statement.
  const statementDay = input.statementDay ?? (latestRecorded ? parts(latestRecorded.closingDate).day : null);

  const empty: CardSnapshot = {
    hasCycle: false,
    statement: null,
    paidSinceStatement: 0,
    leftOnStatement: 0,
    minimumLeft: null,
    status: null,
    daysToDue: null,
    chargesSinceStatement: 0,
    creditsSinceStatement: 0,
    outstanding: null,
    available: null,
    utilization: null,
    nextClose: null,
    nextDue: null,
    cycles: [],
    duplicatePayments: dropped,
    recent: [...activity].filter((a) => a.date > addDays(today, -30)).sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
  if (!statementDay) return empty;

  // Which statement is the latest: the cycle that most recently closed.
  const close = closeOnOrBefore(today, statementDay);
  let balance: number;
  let basis: "RECORDED" | "ROLLED_FORWARD" | "ESTIMATED";
  let minimumDue: number | null = null;
  let recordedId: string | null = null;
  let due = dueAfter(close, input.dueDay);

  if (latestRecorded && latestRecorded.closingDate >= close) {
    // Typed in for this cycle (or a later, odd closing date): use it as is.
    const s = latestRecorded;
    balance = s.balance;
    basis = "RECORDED";
    minimumDue = s.minimumDue;
    recordedId = s.id;
    if (s.dueDate) due = { date: s.dueDate, approx: false };
    return finish(s.closingDate);
  }
  if (latestRecorded) {
    const f = sums(activity, latestRecorded.closingDate, close);
    balance = r2(latestRecorded.balance - f.payments - f.credits + f.charges);
    basis = "ROLLED_FORWARD";
  } else {
    const f = sums(activity, prevClose(close, statementDay), close);
    balance = r2(f.charges - f.credits);
    basis = "ESTIMATED";
  }
  return finish(close);

  function finish(anchor: string): CardSnapshot {
    const since = sums(activity, anchor, today);
    const leftOnStatement = r2(Math.max(0, balance - since.payments));
    const outstanding = r2(balance - since.payments - since.credits + since.charges);
    const daysToDue = daysBetween(today, due.date);
    const status: StatementStatus =
      balance <= EPS ? "NOTHING_DUE" : leftOnStatement <= EPS ? "PAID" : daysToDue < 0 ? "OVERDUE" : "DUE";
    const nc = nextClose(anchor, statementDay!);
    const cycles: CycleSummary[] = [];
    for (let end = anchor, i = 0; i < 6; i++) {
      const start = prevClose(end, statementDay!);
      const s = sums(activity, start, end);
      cycles.push({ start, close: end, ...s, statementBalance: input.statements.find((x) => x.closingDate === end)?.balance ?? null });
      end = start;
    }
    return {
      hasCycle: true,
      statement: { close: anchor, balance, basis, minimumDue, dueDate: due.date, dueDateApprox: due.approx, recordedId },
      paidSinceStatement: since.payments,
      leftOnStatement,
      minimumLeft: minimumDue == null ? null : r2(Math.max(0, minimumDue - since.payments)),
      status,
      daysToDue,
      chargesSinceStatement: since.charges,
      creditsSinceStatement: since.credits,
      outstanding,
      available: creditLimit ? r2(creditLimit - outstanding) : null,
      utilization: creditLimit ? outstanding / creditLimit : null,
      nextClose: nc,
      nextDue: dueAfter(nc, input.dueDay).date,
      cycles,
      duplicatePayments: dropped,
      recent: activity.filter((a) => a.date > anchor && a.date <= today).sort((a, b) => (a.date < b.date ? 1 : -1)),
    };
  }
}

// How a transaction logged on a card counts. Spending is a charge; money in
// is a payment when it's a transfer-type category or reads like one
// ("PAYMENT - THANK YOU", "AUTOPAY"), otherwise a refund or cashback credit.
export function classifyCardTransaction(direction: "INCOME" | "EXPENSE", kind: string, text: string): ActivityKind {
  if (direction === "EXPENSE") return "CHARGE";
  if (kind === "TRANSFER" || kind === "LOAN" || /\bpayment\b|thank you|autopay|\bpymt\b|e-?payment/i.test(text)) return "PAYMENT";
  return "CREDIT";
}

// ---- due-date reminders ------------------------------------------------------

// Days before the due date to remind (0 = the day itself, -1 = the day after,
// if it's still unpaid).
export const CARD_REMINDER_DAYS = [5, 1, 0, -1];

function fmt(n: number, currency: string) {
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `;
  return `${sym}${n.toLocaleString(currency === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

// The reminder for a card today, or null when none is due: only an unpaid
// statement, and only on the reminder days.
export function cardReminder(card: { name: string; last4: string | null; currency: string }, s: CardSnapshot): string | null {
  if (!s.statement || s.daysToDue == null || !CARD_REMINDER_DAYS.includes(s.daysToDue)) return null;
  if (s.leftOnStatement <= EPS) return null;
  const name = `${card.name}${card.last4 ? ` ••${card.last4}` : ""}`;
  const when =
    s.daysToDue === 0 ? "is due today" : s.daysToDue === 1 ? "is due tomorrow" : s.daysToDue < 0 ? "was due yesterday and isn't paid" : `is due in ${s.daysToDue} days`;
  const min = s.minimumLeft != null && s.minimumLeft > EPS && s.minimumLeft < s.leftOnStatement - EPS ? ` (minimum ${fmt(s.minimumLeft, card.currency)})` : "";
  const tail = s.daysToDue < 0 ? " Pay it today to limit the late fee and interest." : " Pay the full amount to avoid interest.";
  return `${name}: ${fmt(s.leftOnStatement, card.currency)} ${when} (${shortDate(s.statement.dueDate)})${min}.${tail}`;
}
