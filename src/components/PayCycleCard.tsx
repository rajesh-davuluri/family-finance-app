"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/formatDate";

type UpcomingBill = {
  id: string;
  categoryName: string;
  instrumentName: string;
  amount: string;
  currency: string;
  nextRunAt: string;
};

type PayCycleData =
  | { hasData: false }
  | {
      hasData: true;
      lastPaycheck: { date: string; amount: string; currency: string; instrumentName: string };
      nextPaycheck: { date: string; daysUntil: number };
      spentSoFarUsd: number;
      otherIncomeUsd: number;
      upcomingBills: UpcomingBill[];
      upcomingCommittedUsd: number;
      availableNowUsd: number;
      availableAfterBillsUsd: number;
    };

function Money({ value, tone }: { value: number; tone?: "income" | "expense" | "auto" }) {
  const resolvedTone = tone === "auto" ? (value >= 0 ? "income" : "expense") : tone;
  const colorClass = resolvedTone === "income" ? "text-income-600" : resolvedTone === "expense" ? "text-expense-600" : "text-ink-900";
  return <span className={`font-mono ${colorClass}`}>${value.toFixed(2)}</span>;
}

export default function PayCycleCard({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<PayCycleData | null>(null);

  useEffect(() => {
    fetch("/api/pay-cycle")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ hasData: false }));
  }, [refreshKey]);

  if (!data) return null;

  if (!data.hasData) {
    return (
      <div className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-medium text-gray-700">Current pay cycle</h2>
        <p className="mt-1 text-sm text-gray-500">
          Add a transaction in the &ldquo;Salary&rdquo; category when you get paid, and this will show where that
          paycheck stands.
        </p>
      </div>
    );
  }

  const { lastPaycheck, nextPaycheck, spentSoFarUsd, otherIncomeUsd, upcomingBills, upcomingCommittedUsd, availableNowUsd, availableAfterBillsUsd } =
    data;

  return (
    <div className="rounded-lg border border-l-4 border-l-brand-500 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-700">
          Current pay cycle{" "}
          <Link href="/paychecks" className="ml-1 text-xs font-normal text-brand-600 hover:underline">
            All paychecks →
          </Link>
        </h2>
        <p className="text-xs text-gray-500">
          Paid {lastPaycheck.currency} {Number(lastPaycheck.amount).toFixed(2)} on {formatDate(lastPaycheck.date)} (
          {lastPaycheck.instrumentName}) · next expected {formatDate(nextPaycheck.date)} (
          {nextPaycheck.daysUntil === 0 ? "today" : `in ${nextPaycheck.daysUntil} day${nextPaycheck.daysUntil === 1 ? "" : "s"}`}
          )
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-gray-500">Spent so far</p>
          <p className="font-display text-lg font-semibold">
            <Money value={spentSoFarUsd} tone="expense" />
          </p>
        </div>
        {otherIncomeUsd > 0 && (
          <div>
            <p className="text-xs text-gray-500">Other income this cycle</p>
            <p className="font-display text-lg font-semibold">
              <Money value={otherIncomeUsd} tone="income" />
            </p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-500">Committed upcoming bills</p>
          <p className="font-display text-lg font-semibold">
            <Money value={upcomingCommittedUsd} tone="expense" />
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Available now</p>
          <p className="font-display text-lg font-semibold">
            <Money value={availableNowUsd} tone="auto" />
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">After upcoming bills</p>
          <p className="font-display text-lg font-semibold">
            <Money value={availableAfterBillsUsd} tone="auto" />
          </p>
        </div>
      </div>

      {upcomingBills.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-xs font-medium text-gray-500">Due before your next paycheck</p>
          <div className="space-y-1.5">
            {upcomingBills.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span>
                  {b.categoryName} <span className="text-gray-400">· {b.instrumentName}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-gray-400">{formatDate(b.nextRunAt)}</span>
                  <span className="font-mono text-expense-600">
                    {b.currency} {Number(b.amount).toFixed(2)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        Figures shown in approx. USD when currencies are mixed. &ldquo;Available now&rdquo; = this paycheck + any
        other income since it landed − what&rsquo;s been spent so far. &ldquo;After upcoming bills&rdquo; subtracts
        what&rsquo;s still due before the next paycheck.
      </p>
    </div>
  );
}
