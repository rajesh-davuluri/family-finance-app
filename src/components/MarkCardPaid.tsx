"use client";

import { useEffect, useState } from "react";
import { getTodayLocal } from "@/lib/formatDate";
import { money } from "@/lib/money";
import { announceTransactionsChanged } from "@/lib/events";
import type { CardSnapshot } from "@/lib/cards";

// "Mark as paid" for a credit card bill: how much (the statement, the
// minimum, everything owed, or another amount), from which bank account and
// on what day. Saved as a transfer from that account to the card -- see
// /api/cards/[id]/pay.

type Card = { id: string; name: string; last4: string | null; currency: string; snapshot: CardSnapshot };
type Account = { id: string; name: string; type: string; currency: string; archived: boolean };

export default function MarkCardPaid({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: () => void }) {
  const s = card.snapshot;
  const options = [
    { key: "statement", label: "Statement balance", amount: s.leftOnStatement },
    ...(s.minimumLeft != null && s.minimumLeft > 0.005 && s.minimumLeft < s.leftOnStatement - 0.005
      ? [{ key: "minimum", label: "Minimum payment", amount: s.minimumLeft }]
      : []),
    ...(s.outstanding != null && s.outstanding > s.leftOnStatement + 0.005 ? [{ key: "all", label: "Everything owed now", amount: s.outstanding }] : []),
  ].filter((o) => o.amount > 0.005);

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [choice, setChoice] = useState(options[0]?.key ?? "other");
  const [other, setOther] = useState("");
  const [fromId, setFromId] = useState("");
  const [date, setDate] = useState(getTodayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/instruments")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Account[]) => {
        const banks = list.filter((a) => !a.archived && a.type !== "CREDIT_CARD" && a.currency === card.currency);
        // A bank account before cash or a wallet.
        banks.sort((a, b) => Number(b.type === "BANK_ACCOUNT") - Number(a.type === "BANK_ACCOUNT"));
        setAccounts(banks);
        setFromId(banks[0]?.id ?? "");
      })
      .catch(() => setAccounts([]));
  }, [card.currency]);

  const amount = choice === "other" ? Number(other.replace(/[,$₹\s]/g, "")) : options.find((o) => o.key === choice)?.amount ?? 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!fromId) return setError("Add the bank account you pay cards from on Accounts & cards first.");
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter the amount you paid.");
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/cards/${card.id}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromInstrumentId: fromId, amount: Math.round(amount * 100) / 100, date }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => null))?.error ?? "Couldn't save the payment.");
    announceTransactionsChanged();
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg sm:rounded-lg"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 sm:hidden" aria-hidden />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Mark {card.name}
            {card.last4 ? ` ••${card.last4}` : ""} paid
          </h2>
          <button type="button" onClick={onClose} className="-mr-2 flex h-10 w-10 items-center justify-center text-gray-400" aria-label="Close">
            ✕
          </button>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs uppercase tracking-wide text-gray-500">How much</legend>
          {options.map((o) => (
            <label key={o.key} className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2.5 ${choice === o.key ? "border-brand-500 bg-brand-50" : ""}`}>
              <span className="flex items-center gap-2 text-sm">
                <input type="radio" name="amount" checked={choice === o.key} onChange={() => setChoice(o.key)} className="h-4 w-4" />
                {o.label}
              </span>
              <span className="tabular-nums font-medium">{money(o.amount, card.currency)}</span>
            </label>
          ))}
          <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 ${choice === "other" ? "border-brand-500 bg-brand-50" : ""}`}>
            <span className="flex items-center gap-2 text-sm">
              <input type="radio" name="amount" checked={choice === "other"} onChange={() => setChoice("other")} className="h-4 w-4" />
              Another amount
            </span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={other}
              onFocus={() => setChoice("other")}
              onChange={(e) => setOther(e.target.value)}
              className="w-28 rounded-md border px-2 py-1.5 text-right tabular-nums"
              aria-label="Amount paid"
            />
          </label>
        </fieldset>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <label>
            <span className="mb-1 block text-xs text-gray-500">Paid from</span>
            {accounts === null ? (
              <span className="block py-2 text-gray-400">Loading…</span>
            ) : accounts.length === 0 ? (
              <span className="block py-2 text-amber-700">No {card.currency} bank account</span>
            ) : (
              <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="w-full rounded-md border px-3 py-2">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label>
            <span className="mb-1 block text-xs text-gray-500">Paid on</span>
            <input type="date" value={date} max={getTodayLocal()} onChange={(e) => setDate(e.target.value)} className="w-full rounded-md border px-3 py-2" required />
          </label>
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Saved as a payment from your bank account to the card. When you import the bank statement later, the same payment is recognised and
          not added twice.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2.5 text-sm text-gray-600">
            Cancel
          </button>
          <button type="submit" disabled={busy || !accounts?.length} className="flex-1 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Saving…" : `Mark ${Number.isFinite(amount) && amount > 0 ? money(amount, card.currency) : ""} paid`}
          </button>
        </div>
      </form>
    </div>
  );
}
