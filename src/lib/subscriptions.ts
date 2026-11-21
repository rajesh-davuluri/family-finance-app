// Subscriptions: the streaming services, apps, memberships and plans that
// charge on a schedule, found in the household's own transactions -- with
// what changed (a price rise, a second charge, a new one, a charge after you
// decided to cancel) and what they cost a month and a year. Pure: the data
// loader (src/lib/subscriptionData.ts) gathers the inputs.
//
// It builds on the recurring-payment detection in src/lib/recurringDetect.ts
// and keeps the streams that read like a subscription rather than rent, a
// loan, insurance, a utility or a regular investment.

import { merchantOf, type Frequency, type HistoryTxn, type RecurringBill } from "@/lib/recurringDetect";

// HIDDEN: "Not a subscription" -- a repeating charge that isn't one (a toll
// top-up, a regular transfer). Kept out of the list, the totals and alerts.
export type MarkStatus = "KEEP" | "CANCEL" | "HIDDEN";
export type SubscriptionMarkInput = { key: string; status: MarkStatus; amount: number | null; markedAt: string };

export type SubscriptionAlert =
  | { kind: "CHARGED_AFTER_CANCEL"; date: string; amount: number }
  | { kind: "DOUBLE"; first: { date: string; account: string }; second: { date: string; account: string }; amount: number }
  | { kind: "PRICE_UP" | "PRICE_DOWN"; from: number; to: number; on: string; perYearUsd: number }
  | { kind: "NEW"; since: string };

export type Subscription = {
  key: string; // the merchant, "m:NETFLIX" -- what a Keep/Cancel mark is stored under
  name: string;
  categoryName: string;
  accounts: string[]; // cards or accounts it was charged to, latest first
  currency: string;
  amount: number; // latest charge, in `currency`
  usd: number;
  frequency: Frequency | null; // null: seen once, schedule not known yet
  firstDate: string;
  lastDate: string;
  nextDate: string | null;
  status: "ACTIVE" | "LATE" | "STOPPED" | "SEEN_ONCE";
  perMonthUsd: number; // 0 once stopped
  perYearUsd: number;
  count: number;
  mark: SubscriptionMarkInput | null;
  alerts: SubscriptionAlert[]; // most pressing first
  // To add it to Recurring bills in one click (a schedule a template supports).
  addable: { categoryId: string; instrumentId: string; frequency: "WEEKLY" | "MONTHLY" | "YEARLY"; nextRunAt: string; notes: string } | null;
  inRecurring: boolean;
  transactionIds: string[];
};

// Not subscriptions: these have pages of their own (Debts, Policies, Year
// ahead) or vary month to month (power, water, gas).
// Tolls and their top-ups, parking and transit repeat too, but aren't
// subscriptions.
const NOT_SUBSCRIPTION = /rent|mortgage|\bloan\b|\bemi\b|insurance|premium|tuition|class fee|daycare|\bhoa\b|\btax\b|electric|energy|power|water|\bgas\b|sewer|trash|utility bill|\btolls?\b|e-?z ?pass|sunpass|fastrak|i-?pass|peach pass|txtag|parking|park ?mobile|\btransit\b|metro ?card|smartrip|clipper|ventra|\bmta\b|\bwmata\b/i;
// Names that are almost always a subscription, worth showing from the first
// charge (a free trial that just turned into a paid plan).
const KNOWN = /netflix|spotify|hulu|disney|youtube|apple\.com|itunes|icloud|google (one|storage|play)|prime video|amazon prime|audible|kindle unl|adobe|microsoft|xbox|playstation|nintendo|chatgpt|openai|anthropic|claude\.ai|peacock|paramount|hbo|max\.com|crunchyroll|patreon|substack|nytimes|new york times|wsj|washington post|duolingo|headspace|calm\.com|peloton|dropbox|zoom\.us|canva|grammarly|linkedin|siriusxm|hotstar|zee5|sonyliv|jiocinema|aha video|github|notion|1password|lastpass|nordvpn|expressvpn|match\.com|tinder|bumble|classpass|planet fitness|la fitness|ymca/i;

// How recent a change has to be to be news.
export const PRICE_NEWS_DAYS = 90;
export const NEW_DAYS = 60;
export const SEEN_ONCE_DAYS = 45;
// A price "change" smaller than this is rounding or tax, not a new price.
const MIN_PRICE_CHANGE = (amt: number) => Math.max(0.5, amt * 0.02);

const DAY = 86_400_000;
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const gap = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);
const r2 = (n: number) => Math.round(n * 100) / 100;
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const merchantKey = (streamKey: string) => streamKey.split("+")[0].split("#")[0];
const addDays = (d: string, n: number) => new Date(toUtc(d) + Math.round(n) * DAY).toISOString().slice(0, 10);
// Names that read better than the statement's spelling.
const NAMES: Record<string, string> = { OPENAI: "ChatGPT (OpenAI)", APPLE: "Apple (iCloud / App Store)", HBO: "HBO Max", YOUTUBE: "YouTube", ICLOUD: "iCloud", PLAYSTATION: "PlayStation", SIRIUSXM: "SiriusXM", LINKEDIN: "LinkedIn", NYTIMES: "New York Times", GITHUB: "GitHub" };
const displayName = (key: string) => NAMES[key.slice(2).split(" ")[0]] ?? titleCase(key.slice(2));
const PER_YEAR: Record<Frequency, number> = { WEEKLY: 52, BIWEEKLY: 26, MONTHLY: 12, QUARTERLY: 4, HALF_YEARLY: 2, YEARLY: 1 };

export type SubscriptionTxn = HistoryTxn & { instrumentId: string };

export function findSubscriptions(input: {
  bills: RecurringBill[];
  history: SubscriptionTxn[];
  marks: SubscriptionMarkInput[];
  // Merchants already set up as recurring bills ("m:NETFLIX").
  recurringKeys: Set<string>;
  today: string;
}): Subscription[] {
  const { today } = input;
  const byId = new Map(input.history.map((t) => [t.id, t]));
  const marks = new Map(input.marks.map((m) => [m.key, m]));
  const out = new Map<string, Subscription>();

  for (const b of input.bills) {
    if (!b.key.startsWith("m:")) continue; // a bill with no description: not a subscription
    if (b.kind !== "SPENDING" && b.kind !== "BILL") continue;
    const txns = b.transactionIds.map((id) => byId.get(id)).filter((t): t is SubscriptionTxn => !!t).sort((a, c) => a.date.localeCompare(c.date));
    if (!txns.length) continue;
    const text = `${b.label} ${b.categoryName} ${txns.map((t) => t.notes ?? "").join(" ")}`;
    if (NOT_SUBSCRIPTION.test(text) && !KNOWN.test(text)) continue;
    const key = merchantKey(b.key);
    const sub = build(key, displayName(key), txns, b.frequency, b.status, b.nextDate, marks.get(key) ?? null, input.recurringKeys.has(key), today);
    // Two streams of one merchant (Amazon Prime and Amazon Music): keep both,
    // under keys of their own.
    let k = key;
    for (let n = 2; out.has(k); n++) k = `${key}|${n}`;
    out.set(k, { ...sub, key: k, mark: marks.get(k) ?? sub.mark });
  }

  // A known subscription with too few charges for the recurring detector:
  // twice about a month or a year apart, or once lately (a trial that just
  // became a paid plan).
  const seen = new Set([...out.values()].flatMap((s) => s.transactionIds));
  const fresh = new Map<string, SubscriptionTxn[]>();
  for (const t of input.history) {
    if (seen.has(t.id) || t.amount <= 0) continue;
    if (t.kind !== "SPENDING" && t.kind !== "BILL") continue;
    if (!KNOWN.test(`${t.notes ?? ""}`)) continue;
    const m = merchantOf(t.notes);
    if (!m) continue;
    const key = `m:${m}`;
    if (out.has(key)) continue;
    fresh.set(key, [...(fresh.get(key) ?? []), t]);
  }
  for (const [key, all] of fresh) {
    all.sort((a, c) => a.date.localeCompare(c.date));
    // The latest charges at the latest price (within 30%).
    const last = all[all.length - 1];
    const txns = all.filter((t) => Math.abs(t.amount - last.amount) <= 0.3 * last.amount).slice(-2);
    const step = txns.length === 2 ? gap(txns[0].date, txns[1].date) : 0;
    const freq: Frequency | null = step >= 340 && step <= 390 ? "YEARLY" : step >= 25 && step <= 38 ? "MONTHLY" : null;
    const name = displayName(key);
    if (freq) {
      const days = freq === "YEARLY" ? 365 : 30;
      const late = gap(last.date, today);
      const status = late > days * 2.5 ? "STOPPED" : late > days * 1.4 ? "LATE" : "ACTIVE";
      let next = addDays(last.date, freq === "YEARLY" ? 365 : 30.44);
      if (status === "ACTIVE") while (next < today) next = addDays(next, freq === "YEARLY" ? 365 : 30.44);
      out.set(key, build(key, name, txns, freq, status, next, marks.get(key) ?? null, input.recurringKeys.has(key), today));
    } else if (gap(last.date, today) <= SEEN_ONCE_DAYS) {
      out.set(key, build(key, name, [last], null, "SEEN_ONCE", null, marks.get(key) ?? null, input.recurringKeys.has(key), today));
    }
  }

  const weight = (s: Subscription) => (s.alerts.length ? 0 : 1);
  const order = { ACTIVE: 0, SEEN_ONCE: 1, LATE: 2, STOPPED: 3 };
  return [...out.values()].sort((a, c) => order[a.status] - order[c.status] || weight(a) - weight(c) || c.perYearUsd - a.perYearUsd);
}

function build(
  key: string,
  name: string,
  txns: SubscriptionTxn[],
  frequency: Frequency | null,
  status: Subscription["status"],
  nextDate: string | null,
  mark: SubscriptionMarkInput | null,
  inRecurring: boolean,
  today: string,
): Subscription {
  const last = txns[txns.length - 1];
  const usdRate = last.amount ? last.usd / last.amount : 1;
  const counts = status === "ACTIVE" || status === "LATE";
  const perYearUsd = frequency && counts ? r2(last.usd * PER_YEAR[frequency]) : 0;
  const alerts: SubscriptionAlert[] = [];

  // Charged again after you decided to cancel it.
  if (mark?.status === "CANCEL") {
    const after = txns.filter((t) => t.date > mark.markedAt.slice(0, 10));
    if (after.length) alerts.push({ kind: "CHARGED_AFTER_CANCEL", date: after[after.length - 1].date, amount: after[after.length - 1].amount });
  }

  // Charged twice: the same amount twice within days (two cards, or a
  // double charge), in the last couple of cycles.
  const recent = txns.filter((t) => gap(t.date, today) <= 70);
  const window = frequency === "WEEKLY" ? 2 : 6;
  for (let i = recent.length - 1; i > 0; i--) {
    const a = recent[i - 1];
    const b = recent[i];
    if (gap(a.date, b.date) <= window && Math.abs(a.amount - b.amount) < 0.01) {
      alerts.push({ kind: "DOUBLE", first: { date: a.date, account: a.instrumentName }, second: { date: b.date, account: b.instrumentName }, amount: b.amount });
      break;
    }
  }

  // The latest price change, if recent and not already seen (a Keep made
  // after it acknowledges it).
  const days = dedupeDays(txns);
  for (let i = days.length - 1; i > 0; i--) {
    const from = days[i - 1].amount;
    const to = days[i].amount;
    if (Math.abs(to - from) < MIN_PRICE_CHANGE(from)) continue;
    const on = days[i].date;
    const acknowledged = mark?.status === "KEEP" && mark.markedAt.slice(0, 10) >= on;
    if (gap(on, today) <= PRICE_NEWS_DAYS && !acknowledged) {
      alerts.push({ kind: to > from ? "PRICE_UP" : "PRICE_DOWN", from, to, on, perYearUsd: frequency ? r2((to - from) * usdRate * PER_YEAR[frequency]) : 0 });
    }
    break;
  }

  // New: started recently and not decided on yet.
  const first = txns[0].date;
  if (!mark && gap(first, today) <= NEW_DAYS) alerts.push({ kind: "NEW", since: first });

  if (mark?.status === "HIDDEN") alerts.length = 0;
  const rank = { CHARGED_AFTER_CANCEL: 0, DOUBLE: 1, PRICE_UP: 2, NEW: 3, PRICE_DOWN: 4 };
  alerts.sort((a, c) => rank[a.kind] - rank[c.kind]);

  const plan = frequency === "WEEKLY" || frequency === "MONTHLY" || frequency === "YEARLY" ? frequency : null;
  const accounts = [...new Set([...txns].reverse().map((t) => t.instrumentName))];
  return {
    key,
    name,
    categoryName: last.categoryName,
    accounts,
    currency: last.currency,
    amount: last.amount,
    usd: last.usd,
    frequency,
    firstDate: first,
    lastDate: last.date,
    nextDate: counts ? nextDate : null,
    status,
    perMonthUsd: r2(perYearUsd / 12),
    perYearUsd,
    count: txns.length,
    mark,
    alerts,
    addable: plan && counts && nextDate ? { categoryId: last.categoryId, instrumentId: last.instrumentId, frequency: plan, nextRunAt: nextDate, notes: last.notes ?? name } : null,
    inRecurring,
    transactionIds: txns.map((t) => t.id),
  };
}

// One amount per charge day (a split or re-entered charge counts once).
function dedupeDays(txns: SubscriptionTxn[]) {
  const byDay = new Map<string, number>();
  for (const t of txns) byDay.set(t.date, t.amount);
  return [...byDay.entries()].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date));
}

// One line for an alert, for the page and for Needs attention.
export function alertText(s: Subscription, a: SubscriptionAlert, money: (n: number) => string, day: (d: string) => string): string {
  switch (a.kind) {
    case "CHARGED_AFTER_CANCEL":
      return `${s.name} charged ${money(a.amount)} on ${day(a.date)}, after you marked it to cancel`;
    case "DOUBLE":
      return a.first.account === a.second.account
        ? `${s.name} charged ${money(a.amount)} twice: ${day(a.first.date)} and ${day(a.second.date)} on ${a.first.account}`
        : `${s.name} charged ${money(a.amount)} on two cards: ${a.first.account} (${day(a.first.date)}) and ${a.second.account} (${day(a.second.date)})`;
    case "PRICE_UP":
      return `${s.name} went up from ${money(a.from)} to ${money(a.to)} on ${day(a.on)}${a.perYearUsd ? ` (+$${Math.round(a.perYearUsd).toLocaleString("en-US")} a year)` : ""}`;
    case "PRICE_DOWN":
      return `${s.name} went down from ${money(a.from)} to ${money(a.to)} on ${day(a.on)}`;
    case "NEW":
      return `New subscription: ${s.name}, ${money(s.amount)} since ${day(a.since)}`;
  }
}

export const isHidden = (s: Subscription) => s.mark?.status === "HIDDEN";

export function totals(subs: Subscription[]) {
  const counted = subs.filter((s) => (s.status === "ACTIVE" || s.status === "LATE") && !isHidden(s));
  const perYear = counted.reduce((n, s) => n + s.perYearUsd, 0);
  const toCancel = counted.filter((s) => s.mark?.status === "CANCEL").reduce((n, s) => n + s.perYearUsd, 0);
  return { count: counted.length, perMonthUsd: r2(perYear / 12), perYearUsd: r2(perYear), toCancelPerYearUsd: r2(toCancel) };
}
