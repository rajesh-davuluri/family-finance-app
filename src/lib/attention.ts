// "Needs attention" on the dashboard: the few things worth acting on now,
// most urgent first. Pure -- the API route gathers the inputs.

export type AttentionItem = { key: string; level: "high" | "medium"; text: string; href: string };

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
// The most categories listed one by one; the rest are summed up in a line.
export const MAX_CATEGORY_ITEMS = 4;

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
  const items: AttentionItem[] = over.slice(0, MAX_CATEGORY_ITEMS).map(({ c, marks, budget }) => ({
    key: `category:${c.name}`,
    level: "medium",
    text: `${c.name}: ${whole(c.spent)} this month, past ${list(marks.map((m) => m.text))}`,
    href: budget ? "/budgets" : "/reports",
  }));
  const rest = over.slice(MAX_CATEGORY_ITEMS);
  if (rest.length) {
    items.push({ key: "category:more", level: "medium", text: `${rest.length} more ${rest.length === 1 ? "category is" : "categories are"} past last month or the usual: ${list(rest.map((x) => x.c.name))}`, href: "/reports" });
  }
  return items;
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
  // The payday planner's first dip under the cushion in the next 30 days
  // (src/lib/cashPlan.ts); when the planner ran, it replaces the rougher
  // "banks short of the card bills" check.
  cashPlan?: { ran: boolean; tight: { start: string; lowest: number; lowestDate: string; under: number; cause: string | null; actBy: string; actByDays: number; daysAway: number } | null };
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const t = input.cashPlan?.tight;
  if (t) {
    const when = (d: string, days: number) => (days <= 0 ? "today" : days === 1 ? "tomorrow" : `on ${new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`);
    items.push({
      key: "cash-tight",
      level: t.daysAway <= 7 ? "high" : "medium",
      text: `Cash may drop to ${t.lowest < 0 ? "−" : ""}${fmt(t.lowest)} ${when(t.lowestDate, t.daysAway)}${t.cause ? ` after the ${t.cause}` : ""}, ${fmt(t.under)} under your cushion. Act ${t.actByDays <= 0 ? "today" : `by ${when(t.actBy, t.actByDays).replace(/^on /, "")}`}`,
      href: "/plan",
    });
  }
  for (const c of input.cards) {
    if (c.leftOnStatement <= 0.005 || c.daysToDue == null || c.daysToDue > 5) continue;
    items.push({
      key: `card:${c.name}`,
      level: c.daysToDue <= 1 ? "high" : "medium",
      text: `${c.name}: ${fmt(c.leftOnStatement, c.currency)} ${dueWords(c.daysToDue)}`,
      href: "/cards",
    });
  }
  if (!input.cashPlan?.ran && input.bankUsd != null && input.cardBillsUsd > 0.005 && input.bankUsd < input.cardBillsUsd) {
    items.push({
      key: "short",
      level: "high",
      text: `Banks are ${fmt(input.cardBillsUsd - input.bankUsd)} short of the card bills due in the next 2 weeks`,
      href: "/cards",
    });
  }
  items.push(...categoryItems(input.categories));
  if (input.likelyDuplicates > 0) {
    items.push({
      key: "dups",
      level: "medium",
      text: `${input.likelyDuplicates} likely duplicate transaction${input.likelyDuplicates === 1 ? "" : "s"} to review`,
      href: "/transactions",
    });
  }
  for (const c of input.checks ?? []) {
    const on = new Date(`${c.asOfDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const href = c.card ? "/cards" : "/instruments";
    if (!c.matched)
      items.push({
        key: `check:${c.name}`,
        level: "medium",
        text: c.card ? `${c.name} shows ${fmt(c.diff, c.currency)} ${c.diff > 0 ? "less" : "more"} owed than the card for ${on}` : `${c.name} is ${fmt(c.diff, c.currency)} ${c.diff > 0 ? "under" : "over"} the bank's balance for ${on}`,
        href,
      });
    else if (c.daysSince >= CHECK_STALE_DAYS) items.push({ key: `check-old:${c.name}`, level: "medium", text: `${c.name} was last checked against the ${c.card ? "card" : "bank"} ${c.daysSince} days ago`, href });
  }
  const toClose = (input.closes ?? []).filter((c) => c.status === "DUE");
  if (toClose.length === 1) {
    items.push({ key: "close:due", level: "medium", text: `${toClose[0].name}: ${toClose[0].dueLabel ?? "the latest period"} isn't closed yet`, href: "/close" });
  } else if (toClose.length > 1) {
    const names = toClose.map((c) => c.name);
    items.push({ key: "close:due", level: "medium", text: `${toClose.length} accounts to close for the period: ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`, href: "/close" });
  }
  for (const c of (input.closes ?? []).filter((x) => x.status === "CHANGED")) {
    const on = c.closedThrough ? new Date(`${c.closedThrough}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "its last close";
    items.push({ key: `close:changed:${c.name}`, level: "medium", text: `${c.name} changed after it was closed through ${on}: now ${fmt(c.offNow, c.currency)} off`, href: "/close" });
  }
  for (const s of input.stale) {
    items.push({ key: `stale:${s.name}`, level: "medium", text: `${s.name}: nothing new for ${s.days} days — import a statement?`, href: "/import" });
  }
  const order = { high: 0, medium: 1 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}
