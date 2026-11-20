// "Needs attention" on the dashboard: the few things worth acting on now,
// most urgent first. Pure -- the API route gathers the inputs.

// `rank`: how much the line matters among lines of the same level (lower
// first). The dashboard shows the first few; the rest sit behind "more".
export type AttentionItem = { key: string; level: "high" | "medium"; rank: number; text: string; href: string };

// Money about to go short first, then bills, then the books being wrong,
// then habits and housekeeping.
export const RANK = { cash: 1, cards: 2, accountsOff: 3, toClose: 4, categories: 5, owed: 6, duplicates: 7, stale: 8, checkAgain: 9 } as const;
// How many lines the dashboard shows before "Show more".
export const ATTENTION_SHOWN = 4;

const fmt = (n: number, currency = "USD") =>
  `${currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `}${Math.abs(n).toLocaleString(currency === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
// A category is flagged once it's past a mark by this much: $10, or 5% of
// the mark if that's more. A few dollars over isn't worth a place next to a
// bill due this week.
export const OVER_MIN_USD = 10;
export const OVER_MIN_SHARE = 0.05;
// Last month and the average only count as marks from this size up, so a
// category that's usually near nothing doesn't trip on its first purchase.
export const BASELINE_MIN_USD = 25;

export type CategoryMonth = {
  name: string;
  spent: number; // this month so far
  limit: number | null; // its budget
  lastMonth: number | null; // all of last month
  average: number | null; // per month, over the past year's full months
};

const whole = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const past = (spent: number, mark: number | null, floor: number) => mark != null && mark >= floor && spent - mark >= Math.max(OVER_MIN_USD, mark * OVER_MIN_SHARE);

// One line per category that has gone past its budget, last month's total
// or its usual month, naming each mark it crossed -- biggest overshoot first.
export function categoryItems(categories: CategoryMonth[]): AttentionItem[] {
  const over = categories
    .map((c) => {
      const marks: { text: string; by: number }[] = [];
      const budget = past(c.spent, c.limit, 0.01);
      if (budget) marks.push({ text: `its ${whole(c.limit!)} budget`, by: c.spent - c.limit! });
      if (past(c.spent, c.lastMonth, BASELINE_MIN_USD)) marks.push({ text: `last month's ${whole(c.lastMonth!)}`, by: c.spent - c.lastMonth! });
      if (past(c.spent, c.average, BASELINE_MIN_USD)) marks.push({ text: `your usual ${whole(c.average!)} a month`, by: c.spent - c.average! });
      return { c, marks, by: Math.max(0, ...marks.map((m) => m.by)), budget };
    })
    .filter((x) => x.marks.length > 0)
    // Over a budget you set comes before over a habit.
    .sort((a, b) => Number(b.budget) - Number(a.budget) || b.by - a.by);

  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  return over.map(({ c, marks, budget }) => ({
    key: `category:${c.name}`,
    level: "medium",
    rank: RANK.categories,
    text: `${c.name}: ${whole(c.spent)} this month, past ${list(marks.map((m) => m.text))}`,
    href: budget ? "/budgets" : "/reports",
  }));
}
// A balance check older than this is worth repeating (a statement cycle and
// a bit).
export const CHECK_STALE_DAYS = 45;
const dueWords = (d: number) => (d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d} days`);

export function attentionItems(input: {
  cards: { name: string; currency: string; leftOnStatement: number; daysToDue: number | null }[];
  // Each spending category this month, against what it's measured by: its
  // budget (the cap), all of last month, and its monthly average over the
  // past year. Null where there's nothing to compare with.
  categories: CategoryMonth[];
  bankUsd: number | null; // null when no bank balance is set
  cardBillsUsd: number;
  likelyDuplicates: number;
  stale: { name: string; lastDate: string; days: number }[];
  // Bank accounts whose last check against the bank no longer holds, or was
  // made a long time ago (src/lib/balanceCheck.ts).
  // `card`: a credit card checked against what the card says is owed.
  checks?: { name: string; currency: string; asOfDate: string; diff: number; matched: boolean; daysSince: number; card?: boolean }[];
  // Monthly close (src/lib/periodClose.ts): accounts whose latest period
  // isn't closed yet, and closed periods that no longer match.
  closes?: { name: string; currency: string; status: string; dueLabel: string | null; closedThrough: string | null; offNow: number }[];
  // Lent & borrowed: people who have owed you a while (src/lib/personalLoans.ts).
  owedToYou?: { name: string; amountUsd: number; since: string; days: number }[];
  // The payday planner's first dip under the cushion in the next 30 days
  // (src/lib/cashPlan.ts); when the planner ran, it replaces the rougher
  // "banks short of the card bills" check.
  cashPlan?: { ran: boolean; tight: { start: string; lowest: number; lowestDate: string; under: number; cause: string | null; actBy: string; actByDays: number; daysAway: number } | null };
}): AttentionItem[] {
  // One line per kind of problem: several cards due, several accounts off or
  // several categories running high each read as one line, so a busy month
  // doesn't push the bill due tomorrow out of sight.
  const items: AttentionItem[] = [];
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const names = (xs: string[], max = 3) => {
    const shown = xs.slice(0, max);
    const more = xs.length - shown.length;
    if (more > 0) return `${shown.join(", ")} and ${more} more`;
    return shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  };

  const t = input.cashPlan?.tight;
  if (t) {
    const when = (d: string, days: number) => (days <= 0 ? "today" : days === 1 ? "tomorrow" : `on ${day(d)}`);
    items.push({
      key: "cash-tight",
      level: t.daysAway <= 7 ? "high" : "medium",
      rank: RANK.cash,
      text: `Cash may drop to ${t.lowest < 0 ? "−" : ""}${fmt(t.lowest)} ${when(t.lowestDate, t.daysAway)}${t.cause ? ` after the ${t.cause}` : ""}, ${fmt(t.under)} under your cushion. Act ${t.actByDays <= 0 ? "today" : `by ${when(t.actBy, t.actByDays).replace(/^on /, "")}`}`,
      href: "/plan",
    });
  }
  if (!input.cashPlan?.ran && input.bankUsd != null && input.cardBillsUsd > 0.005 && input.bankUsd < input.cardBillsUsd) {
    items.push({ key: "short", level: "high", rank: RANK.cash, text: `Banks are ${fmt(input.cardBillsUsd - input.bankUsd)} short of the card bills due in the next 2 weeks`, href: "/cards" });
  }

  // Card bills due within 5 days, soonest first, in one line.
  const due = input.cards
    .filter((c) => c.leftOnStatement > 0.005 && c.daysToDue != null && c.daysToDue <= 5)
    .sort((a, b) => a.daysToDue! - b.daysToDue!);
  if (due.length) {
    const one = (c: (typeof due)[number]) => `${c.name}: ${fmt(c.leftOnStatement, c.currency)} ${dueWords(c.daysToDue!)}`;
    const usd = due.every((c) => c.currency === "USD");
    const total = due.reduce((s, c) => s + c.leftOnStatement, 0);
    items.push({
      key: "cards",
      level: due[0].daysToDue! <= 1 ? "high" : "medium",
      rank: RANK.cards,
      text: due.length === 1 ? one(due[0]) : `${due.length} card bills due: ${one(due[0])}, ${names(due.slice(1).map((c) => `${c.name} ${dueWords(c.daysToDue!)}`), 2)}${usd ? ` · ${fmt(total)} in all` : ""}`,
      href: "/cards",
    });
  }

  // Accounts that don't match the bank or card, or changed after a close.
  const off: { name: string; text: string; href: string }[] = [];
  for (const c of input.checks ?? []) {
    if (c.matched) continue;
    off.push({
      name: c.name,
      href: c.card ? "/cards" : "/instruments",
      text: c.card ? `${c.name} shows ${fmt(c.diff, c.currency)} ${c.diff > 0 ? "less" : "more"} owed than the card for ${day(c.asOfDate)}` : `${c.name} is ${fmt(c.diff, c.currency)} ${c.diff > 0 ? "under" : "over"} the bank's balance for ${day(c.asOfDate)}`,
    });
  }
  for (const c of (input.closes ?? []).filter((x) => x.status === "CHANGED")) {
    if (off.some((o) => o.name === c.name)) continue;
    off.push({ name: c.name, href: "/close", text: `${c.name} changed after it was closed through ${c.closedThrough ? day(c.closedThrough) : "its last close"}: now ${fmt(c.offNow, c.currency)} off` });
  }
  if (off.length) {
    items.push({
      key: "accounts-off",
      level: "medium",
      rank: RANK.accountsOff,
      text: off.length === 1 ? off[0].text : `${off.length} accounts don't match their statements: ${names(off.map((o) => o.name))}`,
      href: off.every((o) => o.href === off[0].href) ? off[0].href : "/close",
    });
  }

  const toClose = (input.closes ?? []).filter((c) => c.status === "DUE");
  if (toClose.length) {
    items.push({
      key: "close:due",
      level: "medium",
      rank: RANK.toClose,
      text: toClose.length === 1 ? `${toClose[0].name}: ${toClose[0].dueLabel ?? "the latest period"} isn't closed yet` : `${toClose.length} accounts to close for the period: ${names(toClose.map((c) => c.name))}`,
      href: "/close",
    });
  }

  // Categories: the one furthest over in full, the others counted.
  const cats = categoryItems(input.categories);
  if (cats.length) {
    const rest = cats.length - 1;
    items.push({ ...cats[0], key: "categories", text: `${cats[0].text}${rest ? ` · ${rest} more ${rest === 1 ? "category" : "categories"} running high` : ""}` });
  }

  const owing = [...(input.owedToYou ?? [])].sort((a, b) => b.days - a.days);
  if (owing.length) {
    const o = owing[0];
    const rest = owing.length - 1;
    items.push({
      key: "owed",
      level: "medium",
      rank: RANK.owed,
      text: `${o.name} has owed you ${fmt(o.amountUsd)} since ${day(o.since)} (${o.days} days)${rest ? ` · ${rest} more ${rest === 1 ? "person owes" : "people owe"} you over a month` : ""}`,
      href: "/lent",
    });
  }

  if (input.likelyDuplicates > 0) {
    items.push({ key: "dups", level: "medium", rank: RANK.duplicates, text: `${input.likelyDuplicates} likely duplicate transaction${input.likelyDuplicates === 1 ? "" : "s"} to review`, href: "/transactions" });
  }

  const stale = [...input.stale].sort((a, b) => b.days - a.days);
  if (stale.length) {
    items.push({
      key: "stale",
      level: "medium",
      rank: RANK.stale,
      text: stale.length === 1 ? `${stale[0].name}: nothing new for ${stale[0].days} days — import a statement?` : `${stale.length} accounts have nothing new for a while: ${names(stale.map((s) => `${s.name} (${s.days} days)`), 2)} — import statements?`,
      href: "/import",
    });
  }

  const checkAgain = (input.checks ?? []).filter((c) => c.matched && c.daysSince >= CHECK_STALE_DAYS).sort((a, b) => b.daysSince - a.daysSince);
  if (checkAgain.length) {
    const c = checkAgain[0];
    items.push({
      key: "check-again",
      level: "medium",
      rank: RANK.checkAgain,
      text: checkAgain.length === 1 ? `${c.name} was last checked against the ${c.card ? "card" : "bank"} ${c.daysSince} days ago` : `${checkAgain.length} accounts not checked against their statements in ${CHECK_STALE_DAYS}+ days: ${names(checkAgain.map((x) => x.name))}`,
      href: checkAgain.every((x) => x.card) ? "/cards" : checkAgain.every((x) => !x.card) ? "/instruments" : "/close",
    });
  }

  const order = { high: 0, medium: 1 };
  return items.sort((a, b) => order[a.level] - order[b.level] || a.rank - b.rank);
}
