import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toApproxUsd } from "@/lib/fx";
import { CategoryBarChart, MonthlyTrendChart } from "@/components/DashboardCharts";

function monthLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const householdId = user!.householdId;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [thisMonthTxns, trendTxns, recentTxns] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId, date: { gte: monthStart } },
      include: { category: true },
    }),
    prisma.transaction.findMany({
      where: { householdId, date: { gte: sixMonthsAgo } },
      include: { category: true },
    }),
    prisma.transaction.findMany({
      where: { householdId },
      include: { category: true, instrument: true, createdBy: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 8,
    }),
  ]);

  let totalIncome = 0;
  let totalExpense = 0;
  const categoryTotals = new Map<string, number>();

  for (const t of thisMonthTxns) {
    const usd = toApproxUsd(Number(t.amount), t.currency);
    if (t.category.direction === "INCOME") {
      totalIncome += usd;
    } else {
      totalExpense += usd;
      categoryTotals.set(t.category.name, (categoryTotals.get(t.category.name) ?? 0) + usd);
    }
  }
  const categoryData = Array.from(categoryTotals.entries())
    .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const trendMap = new Map<string, { income: number; expense: number }>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    trendMap.set(monthLabel(d), { income: 0, expense: 0 });
  }
  for (const t of trendTxns) {
    const label = monthLabel(t.date);
    const bucket = trendMap.get(label);
    if (!bucket) continue;
    const usd = toApproxUsd(Number(t.amount), t.currency);
    if (t.category.direction === "INCOME") bucket.income += usd;
    else bucket.expense += usd;
  }
  const trendData = Array.from(trendMap.entries()).map(([month, v]) => ({
    month,
    income: Math.round(v.income * 100) / 100,
    expense: Math.round(v.expense * 100) / 100,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Income this month (approx. USD)</p>
          <p className="mt-1 text-2xl font-semibold text-green-600">${totalIncome.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Expenses this month (approx. USD)</p>
          <p className="mt-1 text-2xl font-semibold text-red-600">${totalExpense.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Net this month</p>
          <p className={`mt-1 text-2xl font-semibold ${totalIncome - totalExpense >= 0 ? "text-green-600" : "text-red-600"}`}>
            ${(totalIncome - totalExpense).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-gray-700">Spending by category (this month)</h2>
          <CategoryBarChart data={categoryData} />
        </div>
        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-gray-700">6-month trend</h2>
          <MonthlyTrendChart data={trendData} />
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-gray-700">Recent transactions</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2">Date</th>
              <th className="pb-2">Category</th>
              <th className="pb-2">Instrument</th>
              <th className="pb-2">Added by</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {recentTxns.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="py-2">{t.date.toLocaleDateString()}</td>
                <td className="py-2">{t.category.name}</td>
                <td className="py-2">{t.instrument.name}</td>
                <td className="py-2">{t.createdBy.name}</td>
                <td
                  className={`py-2 text-right font-medium ${
                    t.category.direction === "INCOME" ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {t.category.direction === "INCOME" ? "+" : "-"}
                  {t.currency} {Number(t.amount).toFixed(2)}
                </td>
              </tr>
            ))}
            {recentTxns.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-400">
                  No transactions yet — add your first one on the Transactions page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
