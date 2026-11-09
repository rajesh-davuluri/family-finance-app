// Month-to-date and year-to-date spending for a few everyday categories
// (groceries, food, fuel), with what's needed to judge it: last month by the
// same day, and the monthly average this year. Pure; dates are YYYY-MM-DD.

export const SPEND_GROUPS = [
  { key: "groceries", label: "Groceries", match: /grocer|kirana/i },
  { key: "food", label: "Food", match: /^(food|dining|restaurants?|eating out|eat out|take ?out)\b/i },
  { key: "gas", label: "Car gas", match: /^(gas|fuel|petrol|car gas|gasoline)\b/i },
] as const;

export type SpendGroupKey = (typeof SPEND_GROUPS)[number]["key"];
export type SpendRow = { date: string; usd: number; categoryName: string };
export type GroupSpend = {
  key: SpendGroupKey;
  label: string;
  categories: string[]; // the household's categories counted
  mtd: number;
  ytd: number;
  lastMonthToDate: number; // last month, up to the same day of the month
  lastMonth: number; // all of last month
  monthlyAverage: number; // completed months this year
};

const pad = (n: number) => String(n).padStart(2, "0");

export function groupFor(categoryName: string): SpendGroupKey | null {
  return SPEND_GROUPS.find((g) => g.match.test(categoryName.trim()))?.key ?? null;
}

export function summarizeSpend(rows: SpendRow[], today: string, categoryNames: string[]): GroupSpend[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const monthStart = today.slice(0, 8) + "01";
  const yearStart = `${y}-01-01`;
  const lm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const lmDays = new Date(Date.UTC(lm.y, lm.m, 0)).getUTCDate();
  const lmStart = `${lm.y}-${pad(lm.m)}-01`;
  const lmSameDay = `${lm.y}-${pad(lm.m)}-${pad(Math.min(d, lmDays))}`;
  const lmEnd = `${lm.y}-${pad(lm.m)}-${pad(lmDays)}`;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return SPEND_GROUPS.map((g) => {
    const mine = rows.filter((r) => groupFor(r.categoryName) === g.key);
    const sum = (from: string, to: string) => mine.filter((r) => r.date >= from && r.date <= to).reduce((t, r) => t + r.usd, 0);
    const ytd = sum(yearStart, today);
    const mtd = sum(monthStart, today);
    const completedMonths = m - 1;
    return {
      key: g.key,
      label: g.label,
      categories: categoryNames.filter((n) => groupFor(n) === g.key),
      mtd: r2(mtd),
      ytd: r2(ytd),
      lastMonthToDate: r2(sum(lmStart, lmSameDay)),
      lastMonth: r2(sum(lmStart, lmEnd)),
      monthlyAverage: completedMonths > 0 ? r2((ytd - mtd) / completedMonths) : r2(mtd),
    };
  });
}
