// How many months of essential spending the bank cash covers, and what it
// takes to reach the target. Pure.

// Spending that can't stop if income does: rent, EMIs and bills (by kind),
// plus groceries, fuel, medical, insurance, utilities and childcare by name.
export const ESSENTIAL_NAME = /grocer|kirana|\bgas\b|fuel|petrol|medic|health|pharm|insur|utilit|electric|water|internet|phone|mobile|child|daycare|school|tuition|transport/i;
export function isEssential(kind: string, categoryName: string): boolean {
  return kind === "BILL" || kind === "DEBT_PAYMENT" || (kind === "SPENDING" && ESSENTIAL_NAME.test(categoryName));
}

export function emergencyFund(input: { cashUsd: number; months: { essentials: number; total: number }[]; targetMonths: number; paychecksPerYear?: number }) {
  const n = input.months.length;
  const essentials = n ? input.months.reduce((s, m) => s + m.essentials, 0) / n : 0;
  const total = n ? input.months.reduce((s, m) => s + m.total, 0) / n : 0;
  const covered = essentials > 0 ? input.cashUsd / essentials : null;
  const target = essentials * input.targetMonths;
  const gap = Math.max(0, target - input.cashUsd);
  const perYear = input.paychecksPerYear ?? 26;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    essentialsMonthly: r(essentials),
    totalMonthly: r(total),
    monthsCovered: covered == null ? null : Math.round(covered * 10) / 10,
    monthsCoveredAllSpending: total > 0 ? Math.round((input.cashUsd / total) * 10) / 10 : null,
    target: r(target),
    gap: r(gap),
    // Reaching the target in 6 or 12 months, saved from each paycheck.
    perPaycheck6: r(gap / (perYear / 2)),
    perPaycheck12: r(gap / perYear),
  };
}
