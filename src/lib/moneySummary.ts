// The weekly and monthly money summary sent on Telegram: what came in, what
// went out (by category), and the difference. Pure -- the daily job gathers
// the transactions (src/lib/dailyJobs.ts). Counts the way Reports does
// (flowOf): spending is net of refunds; transfers and loans count nowhere.

import { flowOf, type CategoryKind } from "@/lib/categoryKind";

export type SummaryTxn = { usd: number; kind: CategoryKind; categoryName: string };
export type SummaryPeriod = { kind: "WEEK" | "MONTH"; from: string; to: string }; // inclusive dates

// The most expense categories named one by one.
export const TOP_CATEGORIES = 4;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const md = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Which summary, if any, is due on `today` (YYYY-MM-DD, the household's
// calendar day): on Sundays the 7 days before; on the 1st the month before.
// Both on a Sunday the 1st.
export function summariesDue(today: string): SummaryPeriod[] {
  const out: SummaryPeriod[] = [];
  if (new Date(`${today}T00:00:00Z`).getUTCDay() === 0) out.push({ kind: "WEEK", from: addDays(today, -7), to: addDays(today, -1) });
  if (today.slice(8, 10) === "01") {
    const to = addDays(today, -1);
    out.push({ kind: "MONTH", from: `${to.slice(0, 7)}-01`, to });
  }
  return out;
}

export function summarize(txns: SummaryTxn[]) {
  let income = 0;
  let spent = 0;
  let saved = 0;
  const incomeBy = new Map<string, number>();
  const spentBy = new Map<string, number>();
  for (const t of txns) {
    const f = flowOf(t.kind, t.usd);
    income += f.income;
    spent += f.spending;
    saved += f.savings;
    if (f.income) incomeBy.set(t.categoryName, (incomeBy.get(t.categoryName) ?? 0) + f.income);
    if (f.spending) spentBy.set(t.categoryName, (spentBy.get(t.categoryName) ?? 0) + f.spending);
  }
  const sorted = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([name, total]) => ({ name, total: r2(total) }))
      .filter((x) => Math.abs(x.total) >= 0.005)
      .sort((a, b) => b.total - a.total);
  return { income: r2(income), spent: r2(spent), saved: r2(saved), net: r2(income - spent), incomeBy: sorted(incomeBy), spentBy: sorted(spentBy) };
}

// The message, or null when nothing was recorded in the period.
export function summaryText(period: SummaryPeriod, txns: SummaryTxn[]): string | null {
  const s = summarize(txns);
  if (!s.income && !s.spent && !s.saved) return null;
  const title =
    period.kind === "WEEK" ? `📅 Your week, ${md(period.from)} – ${md(period.to)}` : `🗓 Your month: ${FULL_MONTHS[Number(period.from.slice(5, 7)) - 1]} ${period.from.slice(0, 4)}`;
  const lines = [title, ""];
  if (s.income) {
    lines.push(`Income: ${usd(s.income)}`);
    for (const c of s.incomeBy.slice(0, 3)) lines.push(`  • ${c.name} ${usd(c.total)}`);
  }
  lines.push(`Expenses: ${usd(s.spent)}`);
  const top = s.spentBy.slice(0, TOP_CATEGORIES);
  for (const c of top) lines.push(`  • ${c.name} ${usd(c.total)}`);
  const rest = s.spentBy.slice(TOP_CATEGORIES);
  if (rest.length) lines.push(`  • ${rest.length} more ${rest.length === 1 ? "category" : "categories"} ${usd(rest.reduce((n, c) => n + c.total, 0))}`);
  if (s.saved) lines.push(`Saved / invested: ${usd(s.saved)}`);
  if (s.income) lines.push("", `${s.net >= 0 ? "Left over" : "Spent more than came in"}: ${usd(Math.abs(s.net))}`);
  lines.push("", "Amounts in approximate USD. Full details: Reports in the app.");
  return lines.join("\n");
}
