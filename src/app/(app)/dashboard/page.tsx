"use client";

import { useEffect, useState } from "react";
import { CategoryBarChart } from "@/components/DashboardCharts";
import { Analytics } from "@vercel/analytics/next";

type CategorySlice = { id: string; name: string; total: number };

type PeriodSummary = {
  income: number;
  expense: number;
  net: number;
  expenseBreakdown: CategorySlice[];
  incomeBreakdown: CategorySlice[];
};

type SummaryResponse = {
  month: number;
  year: number;
  monthly: PeriodSummary;
  ytd: PeriodSummary;
  monthRange: { from: string; to: string };
  ytdRange: { from: string; to: string };
};

type TransactionDetail = {
  id: string;
  amount: string;
  currency: string;
  date: string;
  notes: string | null;
  instrument: { name: string };
};

type Panel = "monthly" | "ytd";
type Kind = "income" | "expense";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function SummaryCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "income" | "expense" | "net";
  active?: boolean;
  onClick?: () => void;
}) {
  const colorClass =
    tone === "income" ? "text-green-600" : tone === "expense" ? "text-red-600" : value >= 0 ? "text-green-600" : "text-red-600";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-lg border bg-white p-4 text-left ${onClick ? "cursor-pointer transition hover:border-brand-300 hover:shadow-sm" : "cursor-default"} ${active ? "ring-2 ring-brand-400" : ""}`}
    >
      <p className="text-sm text-gray-500">
        {label}
        {onClick && <span className="ml-1 text-xs text-brand-600">(click for breakdown)</span>}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${colorClass}`}>${value.toFixed(2)}</p>
    </button>
  );
}

export default function DashboardPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Which breakdown chart is expanded below: which period grid, and whether
  // Income or Expenses was clicked within it. Nothing shows by default.
  const [expandedPanel, setExpandedPanel] = useState<Panel | null>(null);
  const [expandedKind, setExpandedKind] = useState<Kind | null>(null);

  // Drill-down: which category bar was clicked, and the transactions behind it.
  const [selectedCategory, setSelectedCategory] = useState<CategorySlice | null>(null);
  const [categoryTxns, setCategoryTxns] = useState<TransactionDetail[] | null>(null);
  const [txnsLoading, setTxnsLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/summary?month=${month}&year=${year}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
    // Changing the period invalidates any open breakdown/drill-down.
    setExpandedPanel(null);
    setExpandedKind(null);
    setSelectedCategory(null);
    setCategoryTxns(null);
  }, [month, year]);

  function openPanel(panel: Panel, kind: Kind) {
    const closing = expandedPanel === panel && expandedKind === kind;
    setExpandedPanel(closing ? null : panel);
    setExpandedKind(closing ? null : kind);
    setSelectedCategory(null);
    setCategoryTxns(null);
  }

  async function handleCategoryClick(panel: Panel, category: CategorySlice) {
    if (!data) return;
    if (selectedCategory?.id === category.id) {
      setSelectedCategory(null);
      setCategoryTxns(null);
      return;
    }
    setSelectedCategory(category);
    setTxnsLoading(true);
    const range = panel === "monthly" ? data.monthRange : data.ytdRange;
    const res = await fetch(`/api/transactions?categoryId=${category.id}&from=${range.from}&to=${range.to}&limit=500`);
    const txns = await res.json();
    setCategoryTxns(txns);
    setTxnsLoading(false);
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  const breakdownData =
    expandedPanel && expandedKind && data
      ? expandedKind === "income"
        ? data[expandedPanel].incomeBreakdown
        : data[expandedPanel].expenseBreakdown
      : null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      {/* Monthly grid */}
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-gray-700">Monthly summary</h2>
          <div className="flex gap-2">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded-md border px-2 py-1 text-sm">
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-md border px-2 py-1 text-sm">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading || !data ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Income"
              value={data.monthly.income}
              tone="income"
              active={expandedPanel === "monthly" && expandedKind === "income"}
              onClick={() => openPanel("monthly", "income")}
            />
            <SummaryCard
              label="Expenses"
              value={data.monthly.expense}
              tone="expense"
              active={expandedPanel === "monthly" && expandedKind === "expense"}
              onClick={() => openPanel("monthly", "expense")}
            />
            <SummaryCard label="Net" value={data.monthly.net} tone="net" />
          </div>
        )}
      </div>

      {/* Year-to-date grid */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-gray-700">
          {year === now.getFullYear() ? "Year to date" : `Full year ${year}`}
        </h2>

        {loading || !data ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Income"
              value={data.ytd.income}
              tone="income"
              active={expandedPanel === "ytd" && expandedKind === "income"}
              onClick={() => openPanel("ytd", "income")}
            />
            <SummaryCard
              label="Expenses"
              value={data.ytd.expense}
              tone="expense"
              active={expandedPanel === "ytd" && expandedKind === "expense"}
              onClick={() => openPanel("ytd", "expense")}
            />
            <SummaryCard label="Net" value={data.ytd.net} tone="net" />
          </div>
        )}
      </div>

      {/* Category breakdown chart -- only rendered once Income or Expenses is clicked */}
      {expandedPanel && expandedKind && data && breakdownData && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">
              {expandedKind === "income" ? "Income" : "Expenses"} by category —{" "}
              {expandedPanel === "monthly" ? `${MONTH_NAMES[month - 1]} ${year}` : year === now.getFullYear() ? "year to date" : `full year ${year}`}
            </h2>
            <button
              onClick={() => {
                setExpandedPanel(null);
                setExpandedKind(null);
                setSelectedCategory(null);
                setCategoryTxns(null);
              }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>
          <CategoryBarChart
            data={breakdownData}
            tone={expandedKind}
            selectedCategoryId={selectedCategory?.id}
            onCategoryClick={(cat) => handleCategoryClick(expandedPanel, cat)}
          />
        </div>
      )}

      {/* Transaction-level detail -- only rendered once a category bar is clicked */}
      {selectedCategory && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">
              {selectedCategory.name} transactions — ${selectedCategory.total.toFixed(2)} total
            </h2>
            <button
              onClick={() => {
                setSelectedCategory(null);
                setCategoryTxns(null);
              }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>

          {txnsLoading || !categoryTxns ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2">Date</th>
                  <th className="py-2">Notes</th>
                  <th className="py-2">Instrument</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {categoryTxns.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2">{new Date(t.date).toLocaleDateString()}</td>
                    <td className="py-2 text-gray-500">{t.notes || "—"}</td>
                    <td className="py-2">{t.instrument.name}</td>
                    <td className={`py-2 text-right font-medium ${expandedKind === "income" ? "text-green-600" : "text-red-600"}`}>
                      {t.currency} {Number(t.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {categoryTxns.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-gray-400">
                      No transactions found for this category in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
