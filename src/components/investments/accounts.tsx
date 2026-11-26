"use client";

// Accounts tab: each brokerage/demat/retirement/crypto account with its
// value, gain, where its login is kept, and actions.

import { ACCOUNT_KIND_LABELS, COUNTRY_LABELS, fmtMoney, type HoldingRow } from "@/lib/investments";
import { pctText, tone, type Account } from "./shared";

export function AccountsTab({
  accounts,
  rowOf,
  onEdit,
  onAddHolding,
  onAddAccount,
}: {
  accounts: Account[];
  rowOf: Map<string, HoldingRow>;
  onEdit: (a: Account) => void;
  onAddHolding: (accountId: string) => void;
  onAddAccount: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {accounts.map((acc) => {
          const rows = acc.holdings.map((h) => rowOf.get(h.id)).filter((r): r is HoldingRow => !!r);
          const open = rows.filter((r) => !r.closed);
          const value = open.reduce((s, r) => s + (r.value ?? r.invested), 0);
          const invested = open.reduce((s, r) => s + r.invested, 0);
          const gain = value - invested;
          return (
            <div key={acc.id} className={`rounded-lg border bg-white p-5 ${acc.archived ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{acc.name}</p>
                  <p className="text-xs text-gray-500">
                    {COUNTRY_LABELS[acc.country]} · {ACCOUNT_KIND_LABELS[acc.kind]}
                    {acc.broker && acc.broker !== acc.name ? ` · ${acc.broker}` : ""}
                    {acc.archived ? " · archived" : ""}
                  </p>
                </div>
                <button onClick={() => onEdit(acc)} className="text-xs text-gray-500 hover:underline">
                  Edit
                </button>
              </div>
              <p className="mt-3 font-sans text-2xl font-semibold text-ink-900">{fmtMoney(acc.currency, value)}</p>
              <p className={`text-sm ${tone(gain)}`}>
                {gain >= 0 ? "▲" : "▼"} {fmtMoney(acc.currency, Math.abs(gain))} {invested > 0 ? `(${pctText(gain / invested)})` : ""}
                <span className="text-gray-500">
                  {" "}
                  · {open.length} holding{open.length === 1 ? "" : "s"}
                  {rows.length > open.length ? `, ${rows.length - open.length} sold` : ""}
                </span>
              </p>
              <dl className="mt-3 space-y-1 text-xs text-gray-600">
                {acc.owner && (
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-gray-400">Owner</dt>
                    <dd>{acc.owner}</dd>
                  </div>
                )}
                {acc.loginNote && (
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-gray-400">Login</dt>
                    <dd>{acc.loginNote}</dd>
                  </div>
                )}
                {acc.notes && (
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-gray-400">Notes</dt>
                    <dd className="whitespace-pre-wrap">{acc.notes}</dd>
                  </div>
                )}
              </dl>
              {!acc.archived && (
                <button onClick={() => onAddHolding(acc.id)} className="mt-3 text-xs text-brand-600 hover:underline">
                  + Add holding
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={onAddAccount}
          className="flex min-h-[8rem] items-center justify-center rounded-lg border border-dashed bg-white/60 p-5 text-sm text-gray-500 hover:bg-white hover:text-ink-900"
        >
          + Add an account (Zerodha, Groww, Robinhood, Fidelity, 401(k), crypto...)
        </button>
      </div>
    </div>
  );
}
