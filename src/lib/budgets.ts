// Smart budgets: a monthly limit suggested for each everyday spending
// category from its typical month, and the 80% / over-budget alerts. Pure.

export type CategoryHistory = { categoryId: string; name: string; kind: string; monthly: number[] }; // spend per full month, oldest first
export type Suggestion = { categoryId: string; name: string; typical: number; average: number; highest: number; suggested: number; monthsWithSpend: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Rounded up to an amount that's easy to remember: $5 steps under $100, $10
// under $500, $25 above.
export function roundUp(n: number) {
  const step = n < 100 ? 5 : n < 500 ? 10 : 25;
  return Math.ceil(n / step) * step;
}

// Only everyday spending (groceries, food, shopping, gas...) gets a budget:
// bills and EMIs are fixed, and savings and transfers aren't spending. The
// limit is the typical (median) month, so one unusual month doesn't set it.
export function suggestBudgets(rows: CategoryHistory[], limit = 10): Suggestion[] {
  return rows
    .filter((r) => r.kind === "SPENDING" && r.monthly.length > 0)
    .map((r) => {
      const typical = median(r.monthly);
      return {
        categoryId: r.categoryId,
        name: r.name,
        typical: r2(typical),
        average: r2(r.monthly.reduce((s, x) => s + x, 0) / r.monthly.length),
        highest: r2(Math.max(...r.monthly)),
        suggested: roundUp(Math.max(typical, 1)),
        monthsWithSpend: r.monthly.filter((x) => x > 0).length,
        months: r.monthly.length,
      };
    })
    // Spent in at least half the months, and enough to be worth watching.
    .filter((s) => s.typical >= 20 && s.monthsWithSpend * 2 >= s.months)
    .sort((a, b) => b.typical - a.typical)
    .slice(0, limit)
    .map((s) => ({
      categoryId: s.categoryId,
      name: s.name,
      typical: s.typical,
      average: s.average,
      highest: s.highest,
      suggested: s.suggested,
      monthsWithSpend: s.monthsWithSpend,
    }));
}

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// The alert due today for one budget, or null: "near" at 80%, "over" past
// 100%, each at most once a month.
export function budgetAlert(b: { name: string; limit: number; spent: number; month: string; alertedNear: string | null; alertedOver: string | null; daysLeft: number }) {
  if (b.limit <= 0) return null;
  const pct = Math.round((b.spent / b.limit) * 100);
  const days = b.daysLeft === 0 ? "on the last day of the month" : `with ${b.daysLeft} day${b.daysLeft === 1 ? "" : "s"} to go`;
  if (b.spent > b.limit && b.alertedOver !== b.month) {
    return { level: "over" as const, text: `${b.name} is over budget: ${fmt(b.spent)} of ${fmt(b.limit)} (${pct}%), ${fmt(b.spent - b.limit)} over ${days}.` };
  }
  if (b.spent >= b.limit * 0.8 && b.spent <= b.limit && b.alertedNear !== b.month && b.alertedOver !== b.month) {
    const perDay = b.daysLeft > 0 ? ` — about ${fmt((b.limit - b.spent) / b.daysLeft)} a day left` : "";
    return { level: "near" as const, text: `${b.name}: ${fmt(b.spent)} of ${fmt(b.limit)} budget used (${pct}%) ${days}${perDay}.` };
  }
  return null;
}
