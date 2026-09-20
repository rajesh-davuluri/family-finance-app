"use client";

import { useEffect, useState } from "react";
import { CategoryBarChart } from "@/components/DashboardCharts";
import AddTransactionModal from "@/components/AddTransactionModal";
import { formatDate } from "@/lib/formatDate";

type CategorySlice = { id: string; name: string; total: number };

type PeriodSummary = {
  income: number;
  expense: number;
  net: number;
  expenseBreakdown: CategorySlice[];
  incomeBreakdown: CategorySlice[];
  instrumentBreakdown: CategorySlice[];
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

type BudgetSummary = { id: string; monthlyLimit: string; spent: number; category: { id: string; name: string } };

type UpcomingBill = {
  id: string;
  amount: string;
  currency: string;
  frequency: string;
  nextRunAt: string;
  active: boolean;
  category: { name: string; direction: "INCOME" | "EXPENSE" };
  instrument: { name: string };
};

type ActivityItem = {
  id: string;
  type: "transaction" | "transfer";
  createdByName: string;
  direction: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency: string;
  description: string;
  date: string;
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
    tone === "income" ? "text-income-600" : tone === "expense" ? "text-expense-600" : value >= 0 ? "text-income-600" : "text-expense-600";

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
      <p className={`mt-1 font-display text-2xl font-semibold ${colorClass}`}>${value.toFixed(2)}</p>
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

  // "Add Transaction" popup, launched from the button next to the page title.
  const [showAddModal, setShowAddModal] = useState(false);

  // Compact budget status widget -- independent of the month/year selector
  // above, since a budget is inherently a "this calendar month" concept.
  const [budgets, setBudgets] = useState<BudgetSummary[] | null>(null);

  // Card usage chart: which period it's showing, and drill-down state for
  // clicking a specific card's bar.
  const [cardUsagePeriod, setCardUsagePeriod] = useState<Panel>("monthly");
  const [selectedInstrument, setSelectedInstrument] = useState<CategorySlice | null>(null);
  const [instrumentTxns, setInstrumentTxns] = useState<TransactionDetail[] | null>(null);
  const [instrumentTxnsLoading, setInstrumentTxnsLoading] = useState(false);

  // By-category chart: same pattern as card usage -- always visible, its
  // own Monthly/YTD toggle, independent of the click-to-reveal Income/
  // Expenses breakdown above. Shares the selectedCategory/categoryTxns
  // drill-down state and table with that breakdown, since clicking a bar
  // means the same thing in both places.
  const [categoryUsagePeriod, setCategoryUsagePeriod] = useState<Panel>("monthly");

  // Upcoming bills and household activity -- both independent of the
  // month/year selector, loaded once on mount.
  const [upcomingBills, setUpcomingBills] = useState<UpcomingBill[] | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  function loadSummary() {
    setLoading(true);
    fetch(`/api/dashboard/summary?month=${month}&year=${year}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }

  useEffect(() => {
    loadSummary();
    // Changing the period invalidates any open breakdown/drill-down.
    setExpandedPanel(null);
    setExpandedKind(null);
    setSelectedCategory(null);
    setCategoryTxns(null);
    setSelectedInstrument(null);
    setInstrumentTxns(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  function loadBudgets() {
    fetch("/api/budgets")
      .then((r) => r.json())
      .then(setBudgets);
  }

  useEffect(() => {
    loadBudgets();
  }, []);

  useEffect(() => {
    fetch("/api/recurring")
      .then((r) => r.json())
      .then((templates: UpcomingBill[]) => {
        const in7Days = new Date();
        in7Days.setDate(in7Days.getDate() + 7);
        const upcoming = templates
          .filter((t) => t.active && new Date(t.nextRunAt) <= in7Days)
          .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())
          .slice(0, 5);
        setUpcomingBills(upcoming);
      });

    fetch("/api/activity")
      .then((r) => r.json())
      .then(setActivity);
  }, []);

  function handleTransactionAdded() {
    setShowAddModal(false);
    loadSummary();
    loadBudgets();
    // A new transaction can change whatever breakdown/drill-down was open,
    // so close those rather than show stale figures.
    setExpandedPanel(null);
    setExpandedKind(null);
    setSelectedCategory(null);
    setCategoryTxns(null);
    setSelectedInstrument(null);
    setInstrumentTxns(null);
  }

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

  async function handleInstrumentClick(instrument: CategorySlice) {
    if (!data) return;
    if (selectedInstrument?.id === instrument.id) {
      setSelectedInstrument(null);
      setInstrumentTxns(null);
      return;
    }
    setSelectedInstrument(instrument);
    setInstrumentTxnsLoading(true);
    const range = cardUsagePeriod === "monthly" ? data.monthRange : data.ytdRange;
    const res = await fetch(`/api/transactions?instrumentId=${instrument.id}&from=${range.from}&to=${range.to}&limit=500`);
    const txns = await res.json();
    setInstrumentTxns(txns);
    setInstrumentTxnsLoading(false);
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Add Transaction
        </button>
      </div>

      <AddTransactionModal open={showAddModal} onClose={() => setShowAddModal(false)} onSuccess={handleTransactionAdded} />

      {/* Upcoming bills -- due in the next 7 days, from Recurring templates */}
      {upcomingBills && upcomingBills.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">Upcoming in the next 7 days</h2>
            <a href="/recurring" className="text-xs text-brand-600 hover:underline">
              Manage recurring
            </a>
          </div>
          <div className="space-y-2">
            {upcomingBills.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span>
                  {b.category.name} <span className="text-gray-400">· {b.instrument.name}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-gray-400">{formatDate(b.nextRunAt)}</span>
                  <span className={`font-medium ${b.category.direction === "INCOME" ? "text-income-600" : "text-expense-600"}`}>
                    {b.currency} {Number(b.amount).toFixed(2)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Budget status -- compact, always-visible, links out to the full page */}
      {budgets && budgets.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">Budgets this month</h2>
            <a href="/budgets" className="text-xs text-brand-600 hover:underline">
              Manage budgets
            </a>
          </div>
          <div className="space-y-3">
            {budgets.map((b) => {
              const limit = Number(b.monthlyLimit);
              const pct = Math.min(100, Math.round((b.spent / limit) * 100));
              const over = b.spent > limit;
              const barColor = over ? "bg-expense-600" : pct >= 80 ? "bg-brand-500" : "bg-income-500";
              return (
                <div key={b.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{b.category.name}</span>
                    <span className={over ? "text-expense-600" : "text-gray-500"}>
                      ${b.spent.toFixed(2)} / ${limit.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
                    <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Card usage -- always visible, its own Monthly/YTD toggle */}
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">
            Card usage —{" "}
            {cardUsagePeriod === "monthly" ? `${MONTH_NAMES[month - 1]} ${year}` : year === now.getFullYear() ? "year to date" : `full year ${year}`}
          </h2>
          <div className="flex rounded-md border p-1 text-xs">
            <button
              onClick={() => {
                setCardUsagePeriod("monthly");
                setSelectedInstrument(null);
                setInstrumentTxns(null);
              }}
              className={`rounded px-2 py-1 ${cardUsagePeriod === "monthly" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              Monthly
            </button>
            <button
              onClick={() => {
                setCardUsagePeriod("ytd");
                setSelectedInstrument(null);
                setInstrumentTxns(null);
              }}
              className={`rounded px-2 py-1 ${cardUsagePeriod === "ytd" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              YTD
            </button>
          </div>
        </div>
        {loading || !data ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <CategoryBarChart
            data={data[cardUsagePeriod].instrumentBreakdown}
            tone="expense"
            selectedCategoryId={selectedInstrument?.id}
            onCategoryClick={handleInstrumentClick}
          />
        )}
      </div>

      {/* Card usage transaction-level detail -- only rendered once a card bar is clicked */}
      {selectedInstrument && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">
              {selectedInstrument.name} transactions — ${selectedInstrument.total.toFixed(2)} total
            </h2>
            <button
              onClick={() => {
                setSelectedInstrument(null);
                setInstrumentTxns(null);
              }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>

          {instrumentTxnsLoading || !instrumentTxns ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2">Date</th>
                  <th className="py-2">Notes</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {instrumentTxns.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2">{formatDate(t.date)}</td>
                    <td className="py-2 text-gray-500">{t.notes || "—"}</td>
                    <td className="py-2 text-right font-medium text-expense-600">
                      {t.currency} {Number(t.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {instrumentTxns.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-gray-400">
                      No transactions found for this card in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* By category -- same pattern as card usage: always visible, its own Monthly/YTD toggle */}
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">
            By category —{" "}
            {categoryUsagePeriod === "monthly" ? `${MONTH_NAMES[month - 1]} ${year}` : year === now.getFullYear() ? "year to date" : `full year ${year}`}
          </h2>
          <div className="flex rounded-md border p-1 text-xs">
            <button
              onClick={() => {
                setCategoryUsagePeriod("monthly");
                setSelectedCategory(null);
                setCategoryTxns(null);
              }}
              className={`rounded px-2 py-1 ${categoryUsagePeriod === "monthly" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              Monthly
            </button>
            <button
              onClick={() => {
                setCategoryUsagePeriod("ytd");
                setSelectedCategory(null);
                setCategoryTxns(null);
              }}
              className={`rounded px-2 py-1 ${categoryUsagePeriod === "ytd" ? "bg-brand-600 text-white" : "text-gray-600"}`}
            >
              YTD
            </button>
          </div>
        </div>
        {loading || !data ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <CategoryBarChart
            data={data[categoryUsagePeriod].expenseBreakdown}
            tone="expense"
            selectedCategoryId={selectedCategory?.id}
            onCategoryClick={(cat) => handleCategoryClick(categoryUsagePeriod, cat)}
          />
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
                    <td className="py-2">{formatDate(t.date)}</td>
                    <td className="py-2 text-gray-500">{t.notes || "—"}</td>
                    <td className="py-2">{t.instrument.name}</td>
                    <td className={`py-2 text-right font-medium ${expandedKind === "income" ? "text-income-600" : "text-expense-600"}`}>
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

      {/* Household activity feed -- recent transactions and transfers, who added what */}
      {activity && activity.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Recent activity</h2>
          <div className="space-y-2">
            {activity.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="font-medium">{a.createdByName}</span>{" "}
                  <span className="text-gray-500">{a.type === "transfer" ? "transferred" : "logged"}</span>{" "}
                  {a.description} <span className="text-gray-400">· {formatDate(a.date)}</span>
                </span>
                <span
                  className={`font-medium ${
                    a.direction === "INCOME" ? "text-income-600" : a.direction === "EXPENSE" ? "text-expense-600" : "text-gray-500"
                  }`}
                >
                  {a.currency} {a.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
