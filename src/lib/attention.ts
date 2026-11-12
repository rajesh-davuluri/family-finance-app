// "Needs attention" on the dashboard: the few things worth acting on now,
// most urgent first. Pure -- the API route gathers the inputs.

export type AttentionItem = { key: string; level: "high" | "medium"; text: string; href: string };

const fmt = (n: number, currency = "USD") =>
  `${currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `}${Math.abs(n).toLocaleString(currency === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const dueWords = (d: number) => (d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d} days`);

export function attentionItems(input: {
  cards: { name: string; currency: string; leftOnStatement: number; daysToDue: number | null }[];
  budgets: { name: string; limit: number; spent: number }[];
  bankUsd: number | null; // null when no bank balance is set
  cardBillsUsd: number;
  likelyDuplicates: number;
  stale: { name: string; lastDate: string; days: number }[];
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
  for (const b of input.budgets) {
    if (b.limit > 0 && b.spent > b.limit + 0.005) {
      items.push({ key: `budget:${b.name}`, level: "medium", text: `${b.name} is ${fmt(b.spent - b.limit)} over its ${fmt(b.limit)} budget`, href: "/budgets" });
    }
  }
  if (input.likelyDuplicates > 0) {
    items.push({
      key: "dups",
      level: "medium",
      text: `${input.likelyDuplicates} likely duplicate transaction${input.likelyDuplicates === 1 ? "" : "s"} to review`,
      href: "/transactions",
    });
  }
  for (const s of input.stale) {
    items.push({ key: `stale:${s.name}`, level: "medium", text: `${s.name}: nothing new for ${s.days} days — import a statement?`, href: "/import" });
  }
  const order = { high: 0, medium: 1 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}
