"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/formatDate";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import CollapsibleSection from "@/components/CollapsibleSection";
import { LastActivity, SOURCE_LABELS, STALE_AFTER_DAYS, daysSince, formatDateTime } from "@/lib/lastActivity";

// How fresh the household's records are: the last transaction added, and
// the last one on each card and account (moved here from the dashboard to
// Accounts & cards), plus the household's recent activity feed (on Activity).

function useReload(load: () => void) {
  useEffect(() => {
    load();
    window.addEventListener(TRANSACTIONS_CHANGED, load);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, load);
  }, [load]);
}

export function AccountFreshness() {
  const [lastActivity, setLastActivity] = useState<LastActivity | null>(null);
  const load = useCallback(() => {
    fetch("/api/transactions/last-activity")
      .then((r) => (r.ok ? r.json() : null))
      .then(setLastActivity)
      .catch(() => setLastActivity(null));
  }, []);
  useReload(load);
  if (!lastActivity) return null;
  return (
    <div className="space-y-3">
      <LastAddedLine lastActivity={lastActivity} />
      {lastActivity.instruments.length > 0 && <LastTransactionPerAccount instruments={lastActivity.instruments} />}
    </div>
  );
}

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

export function RecentActivity() {
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const load = useCallback(() => {
    fetch("/api/activity")
      .then((r) => (r.ok ? r.json() : []))
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);
  useReload(load);
  if (!activity || activity.length === 0) return null;
  return (
    <CollapsibleSection storageKey="activity-recent" title="Who added what" summary={`${activity.length} latest`}>
      <div className="space-y-2">
        {activity.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{a.createdByName}</span>{" "}
              <span className="text-gray-500">{a.type === "transfer" ? "transferred" : "logged"}</span> {a.description}{" "}
              <span className="text-gray-400">· {formatDate(a.date)}</span>
            </span>
            <span
              className={`shrink-0 font-medium ${
                a.direction === "INCOME" ? "text-income-600" : a.direction === "EXPENSE" ? "text-expense-600" : "text-gray-500"
              }`}
            >
              {money(a.amount, a.currency)}
            </span>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}

function LastAddedLine({ lastActivity }: { lastActivity: LastActivity }) {
  const last = lastActivity.lastAdded;
  if (!last) {
    return (
      <p className="rounded-lg border bg-white p-3 text-sm text-gray-500">
        No transactions yet — add one or{" "}
        <a href="/import" className="text-brand-600 hover:underline">
          import a statement
        </a>
        .
      </p>
    );
  }
  const days = daysSince(last.createdAt);
  const stale = days >= STALE_AFTER_DAYS;
  return (
    <p
      className={`rounded-lg border p-3 text-sm ${
        stale ? "border-amber-200 bg-amber-50 text-amber-800" : "bg-white text-gray-600"
      }`}
    >
      <span className="font-medium">Last transaction added:</span> {formatDateTime(last.createdAt)} by{" "}
      {last.createdByName} — {last.categoryName} ·{" "}
      <span className={last.direction === "INCOME" ? "text-income-600" : "text-expense-600"}>
        {money(last.amount, last.currency)}
      </span>{" "}
      on {last.instrumentName}, dated {formatDate(last.date)} ({SOURCE_LABELS[last.source]}).
      {stale && (
        <>
          {" "}
          That was {days} days ago —{" "}
          <a href="/import" className="font-medium underline">
            import your latest statements
          </a>
          .
        </>
      )}
    </p>
  );
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  BANK_ACCOUNT: "Bank account",
  CREDIT_CARD: "Credit card",
  CASH: "Cash",
  OTHER: "Other",
};

// Each account's most recent transaction by date -- manual, imported or
// recurring alike -- so it's obvious which cards are up to date.
function LastTransactionPerAccount({ instruments }: { instruments: LastActivity["instruments"] }) {
  const sorted = [...instruments].sort(
    (a, b) => Number(b.type === "CREDIT_CARD") - Number(a.type === "CREDIT_CARD") || a.name.localeCompare(b.name)
  );
  return (
    <CollapsibleSection
      storageKey="dashboard-last-per-account"
      title="Last transaction on each card & account"
      summary={`${instruments.length} account${instruments.length === 1 ? "" : "s"}`}
    >
      {/* Phone: one line per account, the amount always visible. */}
      <ul className="divide-y text-sm md:hidden">
        {sorted.map((i) => {
          const t = i.latestTransaction;
          const stale = t !== null && daysSince(t.date) >= STALE_AFTER_DAYS;
          return (
            <li key={i.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">
                  {i.name}
                  {i.last4 && <span className="font-normal text-gray-400"> ··{i.last4}</span>}
                </span>
                {t && (
                  <span className={`shrink-0 font-medium tabular-nums ${t.direction === "INCOME" ? "text-income-600" : "text-expense-600"}`}>
                    {money(t.amount, t.currency)}
                  </span>
                )}
              </div>
              {t ? (
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  <span className={stale ? "font-medium text-amber-700" : ""}>
                    {formatDate(t.date)} · {daysSince(t.date)}d ago
                  </span>{" "}
                  · {t.notes || t.categoryName}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-gray-400">No transactions yet</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="py-2 pr-3">Account</th>
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Transaction</th>
              <th className="py-2 pr-3 text-right">Amount</th>
              <th className="py-2">Added</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((i) => {
              const t = i.latestTransaction;
              const stale = t !== null && daysSince(t.date) >= STALE_AFTER_DAYS;
              return (
                <tr key={i.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{i.name}</span>
                    {i.last4 && <span className="text-gray-400"> ({i.last4})</span>}
                    <span className="block text-xs text-gray-400">{ACCOUNT_TYPE_LABELS[i.type] ?? i.type}</span>
                  </td>
                  {t ? (
                    <>
                      <td className={`whitespace-nowrap py-2 pr-3 ${stale ? "text-amber-700" : ""}`}>
                        {formatDate(t.date)}
                        <span className="block text-xs text-gray-400">{daysSince(t.date)} days ago</span>
                      </td>
                      <td className="max-w-xs py-2 pr-3">
                        {t.categoryName}
                        {t.notes && (
                          <span className="block truncate text-xs text-gray-400" title={t.notes}>
                            {t.notes}
                          </span>
                        )}
                      </td>
                      <td
                        className={`whitespace-nowrap py-2 pr-3 text-right font-medium ${
                          t.direction === "INCOME" ? "text-income-600" : "text-expense-600"
                        }`}
                      >
                        {money(t.amount, t.currency)}
                      </td>
                      <td className="whitespace-nowrap py-2 text-xs text-gray-500">
                        {formatDateTime(t.createdAt)}
                        <span className="block text-gray-400">
                          {SOURCE_LABELS[t.source]} · {t.createdByName}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="py-2 text-gray-400">
                      No transactions yet
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}
