"use client";

import { useState } from "react";
import { money } from "@/lib/money";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import type { Hint } from "@/lib/balanceCheck";

// Check an account against the bank: type in the balance the bank shows (or
// a statement's closing balance and date) and see whether the app agrees.
// When it doesn't, the likely reasons are listed; fix one and check again,
// or take the bank's figure as the new starting point.

export type LastCheck = { asOfDate: string; checkedAt: string; bankBalance: number; appBalance: number; diff: number; matched: boolean; adjusted: boolean; daysSince: number };
type Result = { asOfDate: string; bankBalance: number; appBalance: number; diff: number; matched: boolean; adjusted: boolean; hints: Hint[] };

const day = (d: string) => formatDate(d, { month: "short", day: "numeric", year: "numeric" });

// One line on where an account (or, with `card`, a credit card) stands
// against the bank's or the card's own figure.
export function CheckBadge({ check, currency, card = false }: { check: LastCheck | null; currency: string; card?: boolean }) {
  if (!check) return null;
  if (!check.matched) {
    return (
      <span className="text-xs font-medium text-expense-600">
        ⚠{" "}
        {card
          ? `${money(Math.abs(check.diff), currency)} ${check.diff > 0 ? "less" : "more"} owed here than the card shows for ${day(check.asOfDate)}`
          : `${money(Math.abs(check.diff), currency)} ${check.diff > 0 ? "under" : "over"} the bank for ${day(check.asOfDate)}`}
      </span>
    );
  }
  return (
    <span className="text-xs text-income-600">
      ✓ {check.adjusted ? "set to" : "matches"} the {card ? "card" : "bank"} for {day(check.asOfDate)}
      <span className="text-gray-400"> · checked {check.daysSince === 0 ? "today" : check.daysSince === 1 ? "yesterday" : `${check.daysSince} days ago`}</span>
    </span>
  );
}

export default function BalanceCheckPanel({
  instrumentId,
  name,
  currency,
  since,
  lastCheck,
  onChanged,
  card = false,
}: {
  instrumentId: string;
  name: string;
  currency: string;
  since: string;
  lastCheck: LastCheck | null;
  onChanged: () => void;
  card?: boolean; // a credit card, checked against what the card says is owed
}) {
  // Re-checking an account that's off starts from what was typed last time.
  const [amount, setAmount] = useState(lastCheck && !lastCheck.matched ? String(lastCheck.bankBalance) : "");
  const [date, setDate] = useState(lastCheck && !lastCheck.matched ? lastCheck.asOfDate : getTodayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function check(useBankFigure = false) {
    const bankBalance = Number(amount.replace(/[,$₹€£\s]/g, ""));
    if (amount.trim() === "" || !Number.isFinite(bankBalance) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError(card ? "Enter what the card says is owed, and the date." : "Enter the balance the bank shows, and the date it's for.");
      return;
    }
    if (useBankFigure && !confirm(`Set ${name} to the bank's ${money(bankBalance, currency)} as of ${day(date)}?\n\nIts balance will build on that figure from the next day. Nothing is deleted, but the ${money(Math.abs(result?.diff ?? 0), currency)} difference is left unexplained.`)) return;
    setBusy(true);
    setError(null);
    const res = card
      ? await fetch(`/api/cards/${instrumentId}/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asOfDate: date, owed: bankBalance }) })
      : await fetch(`/api/instruments/${instrumentId}/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asOfDate: date, bankBalance, useBankFigure }) });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !body) {
      setError(typeof body?.error === "string" ? body.error : "Couldn't check that. Try again.");
      return;
    }
    setResult(body);
    onChanged();
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-medium">
          Check {name} against the {card ? "card" : "bank"}
        </p>
        <p className="text-xs text-gray-500">
          {card
            ? "Use the current balance in the card's app or website (what's owed now, not the statement balance), with today's date."
            : `Use today's balance from the bank's app, or the closing balance and date from a statement. Any date from ${day(since)} on.`}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-gray-600">
          {card ? "Card says owed" : "Bank shows"}
          <input inputMode="decimal" value={amount} onChange={(e) => (setAmount(e.target.value), setResult(null))} onKeyDown={(e) => e.key === "Enter" && check()} placeholder="0.00" className="mt-1 block w-32 rounded border px-2 py-1.5 text-base font-normal tabular-nums" />
        </label>
        <label className="text-xs font-medium text-gray-600">
          As of
          <input type="date" value={date} min={card ? undefined : since} max={getTodayLocal()} onChange={(e) => (setDate(e.target.value), setResult(null))} className="mt-1 block rounded border px-2 py-1.5 text-base font-normal" />
        </label>
        <button onClick={() => check()} disabled={busy} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Checking…" : result && !result.matched ? "Check again" : "Check"}
        </button>
      </div>
      {error && <p className="text-xs text-expense-600">{error}</p>}

      {result?.matched && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-income-600">
          ✓{" "}
          {result.adjusted
            ? `Set to the bank's figure. ${name} now builds on ${money(result.bankBalance, currency)} from the day after ${day(result.asOfDate)}.`
            : card
              ? `Matches. The app and the card both say ${money(result.bankBalance, currency)} owed as of ${day(result.asOfDate)}.`
              : `Matches. The app and the bank both say ${money(result.bankBalance, currency)} as of ${day(result.asOfDate)}.`}
        </p>
      )}

      {result && !result.matched && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="font-medium text-expense-600">
            Off by {money(Math.abs(result.diff), currency)}: the app says {money(result.appBalance, currency)}
            {card ? " owed" : ""}, the {card ? "card" : "bank"} {money(result.bankBalance, currency)}.
          </p>
          <p className="mt-0.5 text-xs text-gray-600">
            {card ? `The app shows ${result.diff > 0 ? "less" : "more"} owed than the card.` : `The app is ${result.diff > 0 ? "short" : "over"}.`} Likely reasons, most telling first:
          </p>
          <ol className="mt-2 space-y-2 text-xs text-gray-700">
            {result.hints.map((h, k) => (
              <li key={k}>
                <p>
                  {k + 1}. {h.text}
                </p>
                {h.items && (
                  <ul className="mt-1 divide-y rounded border bg-white">
                    {h.items.map((i) => (
                      <li key={i.id} className="flex items-baseline justify-between gap-3 px-2 py-1">
                        <span className="min-w-0 truncate">
                          {day(i.date)} · {i.label}
                          {i.notes && <span className="text-gray-400"> · {i.notes}</span>}
                        </span>
                        {/* On a card a charge adds to what's owed; a payment or refund takes it off. */}
                        <span className={`shrink-0 tabular-nums ${(card ? i.amount < 0 : i.amount >= 0) ? "text-income-600" : ""}`}>
                          {card ? (i.amount >= 0 ? "charge " : "paid ") : i.amount >= 0 ? "+" : "−"}
                          {money(Math.abs(i.amount), currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {card ? (
            <p className="mt-3 text-xs text-gray-600">
              Fix it on <a href="/transactions" className="underline">Transactions</a> (or a payment on Accounts &amp; cards → Transfers) and check again. If it
              can&apos;t be found, type in the card&apos;s latest statement with <b>Add statement</b>: the app then works from the card&apos;s own figure.
            </p>
          ) : (
            <p className="mt-3 text-xs text-gray-600">
              Fix it on <a href="/transactions" className="underline">Transactions</a> and check again. If it can&apos;t be found:{" "}
              <button onClick={() => check(true)} disabled={busy} className="font-medium text-brand-700 underline disabled:opacity-50">
                use the bank&apos;s figure
              </button>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
