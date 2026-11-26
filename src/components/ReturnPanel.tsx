"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/money";
import { getTodayLocal } from "@/lib/formatDate";
import { amountToInput, caretToEnd, formatAmountInput, parseAmount } from "@/lib/amountInput";
import { returnText, type ReturnStatus } from "@/lib/returns";

// A purchase's return, inside Edit Transaction: the return-by date, "I'm
// returning this" with the refund expected, and where the refund stands
// (paired automatically when it arrives -- src/lib/returns.ts). Each
// action saves at once.

export type ReturnFields = {
  id: string;
  amount: number;
  currency: string;
  name: string;
  returnBy: string | null;
  returnState: string | null;
};

const json = (body: unknown) => ({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function ReturnPanel({ tx, onChanged }: { tx: ReturnFields; onChanged: () => void }) {
  const [status, setStatus] = useState<ReturnStatus | null>(null);
  const [returnBy, setReturnBy] = useState(tx.returnBy ?? "");
  const [sending, setSending] = useState(false);
  const [expected, setExpected] = useState(amountToInput(tx.amount, tx.currency));
  const [sentOn, setSentOn] = useState(getTodayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch("/api/returns", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setStatus(j?.items?.find((i: { id: string }) => i.id === tx.id)?.status ?? null))
      .catch(() => setStatus(null));
  useEffect(() => {
    // Only a purchase that has return details needs the list.
    if (tx.returnBy || tx.returnState) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.id]);

  async function act(body: unknown) {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/transactions/${tx.id}/return`, json(body));
    setBusy(false);
    if (!r.ok) return setError("Couldn't save that.");
    setSending(false);
    await load();
    onChanged();
  }

  const fmt = (n: number) => money(n, tx.currency);
  const waiting = status && (status.kind === "AWAITING" || status.kind === "LATE");
  const done = status && (status.kind === "REFUNDED" || status.kind === "SHORT" || status.kind === "KEPT");

  return (
    <div className="rounded-md border border-dashed p-3 text-sm sm:col-span-2">
      <p className="mb-1 font-medium text-gray-700">Return</p>
      {status && (
        <p className={`mb-2 ${status.kind === "LATE" || status.kind === "SHORT" ? "text-expense-600" : status.kind === "REFUNDED" ? "text-income-600" : "text-gray-600"}`}>
          {status.kind === "REFUNDED" ? "✓ " : status.kind === "LATE" || status.kind === "SHORT" ? "⚠ " : ""}
          {returnText("This purchase", status, fmt).replace(/^This purchase: /, "")}
        </p>
      )}

      {!waiting && !done && !sending && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-600" htmlFor={`rb-${tx.id}`}>
            Return by
          </label>
          <input id={`rb-${tx.id}`} type="date" value={returnBy} onChange={(e) => setReturnBy(e.target.value)} className="rounded-md border px-2 py-1 text-sm" />
          <button type="button" disabled={busy || returnBy === (tx.returnBy ?? "")} onClick={() => act({ action: "window", returnBy: returnBy || null })} className="text-xs font-medium text-brand-700 hover:underline disabled:text-gray-400 disabled:no-underline">
            Save date
          </button>
          <button type="button" disabled={busy} onClick={() => setSending(true)} className="ml-auto rounded-md border border-brand-400 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
            I&apos;m returning this
          </button>
        </div>
      )}

      {sending && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-600" htmlFor={`rx-${tx.id}`}>
              Refund expected
            </label>
            <input
              id={`rx-${tx.id}`}
              type="text"
              inputMode="decimal"
              value={expected}
              onFocus={caretToEnd}
              onClick={caretToEnd}
              onChange={(e) => setExpected(formatAmountInput(e.target.value, tx.currency))}
              className="w-28 rounded-md border px-2 py-1 text-right text-sm tabular-nums"
            />
            <label className="text-xs text-gray-600" htmlFor={`rs-${tx.id}`}>
              Sent back on
            </label>
            <input id={`rs-${tx.id}`} type="date" value={sentOn} onChange={(e) => setSentOn(e.target.value)} className="rounded-md border px-2 py-1 text-sm" />
          </div>
          <p className="text-xs text-gray-500">When a refund that fits arrives on the card or account, it&apos;s paired with this; if none comes within 2 weeks, you&apos;ll be reminded.</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !(parseAmount(expected) > 0)}
              onClick={() => act({ action: "returning", sentOn, expected: parseAmount(expected) })}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Mark as sent back
            </button>
            <button type="button" onClick={() => setSending(false)} className="px-2 text-xs text-gray-500 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {(waiting || done) && (
        <div className="flex flex-wrap gap-3 text-xs">
          {waiting && (
            <button type="button" disabled={busy} onClick={() => act({ action: "kept" })} className="font-medium text-brand-700 hover:underline">
              Kept it after all
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => act({ action: "clear" })} className="text-gray-500 hover:underline">
            {waiting ? "Not returning it" : "Clear return"}
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-expense-600">{error}</p>}
    </div>
  );
}
