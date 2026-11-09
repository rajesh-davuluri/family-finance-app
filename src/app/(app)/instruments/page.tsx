"use client";

import { Fragment, useEffect, useState } from "react";
import { AccountFreshness } from "@/components/AccountActivity";
import Link from "next/link";
import { money } from "@/lib/money";
import AccountDetailsPanel from "@/components/AccountDetailsPanel";
import { CURRENCIES } from "@/lib/enums";
import { formatDate, getTodayLocal } from "@/lib/formatDate";

type CardOwed = { hasCycle: boolean; owed: number | null; left: number; status: string | null; due: string | null };

type Instrument = {
  id: string;
  name: string;
  type: string;
  last4: string | null;
  currency: string;
  archived: boolean;
  openingBalance: string | null;
  openingBalanceDate: string | null;
  currentBalance: number | null;
  // True when a credit card has no starting balance and currentBalance is
  // just the sum of its transactions and transfers in the app.
  balanceFromTransactionsOnly: boolean;
  creditLimit: string | null;
};

type Transfer = {
  id: string;
  amount: string;
  currency: string;
  date: string;
  notes: string | null;
  fromInstrument: { id: string; name: string };
  toInstrument: { id: string; name: string };
};

const TYPE_LABELS: Record<string, string> = {
  BANK_ACCOUNT: "Bank account",
  CREDIT_CARD: "Credit card",
  CASH: "Cash",
  OTHER: "Other",
};

export default function InstrumentsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  // Credit cards: what's owed, from their statements (the Credit cards page).
  const [cardOwed, setCardOwed] = useState<Map<string, CardOwed>>(new Map());
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "BANK_ACCOUNT", last4: "", currency: "USD", creditLimit: "" });
  const [submitting, setSubmitting] = useState(false);

  // Which instrument's balance is currently being edited, if any.
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  // Which instrument's details (bank, IFSC, account number...) are open.
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [balanceForm, setBalanceForm] = useState({ amount: "", date: getTodayLocal() });

  // Transfer form -- moves money between two of your own instruments
  // without counting as income or an expense (e.g. paying a credit card
  // bill from a bank account).
  const [transferForm, setTransferForm] = useState({
    fromInstrumentId: "",
    toInstrumentId: "",
    amount: "",
    currency: "USD",
    date: getTodayLocal(),
    notes: "",
  });
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [instRes, transferRes, cardsRes] = await Promise.all([fetch("/api/instruments"), fetch("/api/transfers"), fetch("/api/cards")]);
    if (cardsRes.ok) {
      const { cards } = await cardsRes.json();
      setCardOwed(
        new Map(
          (cards as { id: string; snapshot: { hasCycle: boolean; outstanding: number | null; leftOnStatement: number; status: string | null; statement: { dueDate: string } | null } }[]).map((c) => [
            c.id,
            { hasCycle: c.snapshot.hasCycle, owed: c.snapshot.outstanding, left: c.snapshot.leftOnStatement, status: c.snapshot.status, due: c.snapshot.statement?.dueDate ?? null },
          ]),
        ),
      );
    }
    const insts: Instrument[] = await instRes.json();
    setInstruments(insts);
    setTransfers(await transferRes.json());
    setTransferForm((f) => ({
      ...f,
      fromInstrumentId: f.fromInstrumentId || insts.find((i) => !i.archived)?.id || "",
      toInstrumentId: f.toInstrumentId || insts.filter((i) => !i.archived)[1]?.id || "",
    }));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/instruments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        creditLimit: form.type === "CREDIT_CARD" && form.creditLimit ? parseFloat(form.creditLimit) : undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't add that instrument.");
      return;
    }
    setForm({ name: "", type: "BANK_ACCOUNT", last4: "", currency: "USD", creditLimit: "" });
    load();
  }

  async function toggleArchive(id: string, archived: boolean) {
    await fetch(`/api/instruments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !archived }),
    });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this instrument? Only possible if it has no transactions or transfers yet.")) return;
    const res = await fetch(`/api/instruments/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "Couldn't delete — it likely has history. Archive it instead.");
    }
    load();
  }

  // Balances are signed (spending on a card makes it negative), but people
  // think of a card's balance as the amount they owe -- so for credit cards
  // the editor takes "amount owed" as a positive number and flips the sign.
  function startEditingBalance(i: Instrument) {
    const sign = i.type === "CREDIT_CARD" ? -1 : 1;
    setBalanceForm({
      amount: i.openingBalance ? String(sign * Number(i.openingBalance)) : "",
      date: i.openingBalanceDate ? i.openingBalanceDate.slice(0, 10) : getTodayLocal(),
    });
    setEditingBalanceId(i.id);
  }

  async function saveBalance(i: Instrument) {
    const amount = parseFloat(balanceForm.amount);
    if (isNaN(amount)) return;
    const sign = i.type === "CREDIT_CARD" ? -1 : 1;
    await fetch(`/api/instruments/${i.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingBalance: sign * amount, openingBalanceDate: balanceForm.date }),
    });
    setEditingBalanceId(null);
    load();
  }

  async function handleTransferSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTransferError(null);
    if (transferForm.fromInstrumentId === transferForm.toInstrumentId) {
      setTransferError("Pick two different instruments.");
      return;
    }
    setTransferSubmitting(true);
    const res = await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...transferForm, amount: parseFloat(transferForm.amount) }),
    });
    setTransferSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setTransferError(typeof body.error === "string" ? body.error : "Couldn't log that transfer.");
      return;
    }
    setTransferForm((f) => ({ ...f, amount: "", notes: "" }));
    load();
  }

  async function handleDeleteTransfer(id: string) {
    if (!confirm("Delete this transfer? Both instruments' balances will update to reflect it being removed.")) return;
    await fetch(`/api/transfers/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  const activeInstruments = instruments.filter((i) => !i.archived);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Payment instruments</h1>
      <p className="text-sm text-gray-500">
        Bank accounts, credit cards, and cash your household tracks transactions against.
      </p>

      <button
        onClick={() => setShowAdd((v) => !v)}
        className="w-full rounded-lg border border-dashed bg-white px-4 py-3 text-left text-sm text-brand-700 sm:hidden"
      >
        {showAdd ? "Close" : "+ Add an account or card"}
      </button>
      <form onSubmit={handleSubmit} className={`${showAdd ? "grid" : "hidden"} grid-cols-1 gap-3 rounded-lg border bg-white p-4 sm:grid sm:grid-cols-5`}>
        <input
          required
          placeholder="Name (e.g. Chase Checking)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
        />
        <select
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          placeholder="Last 4 (optional)"
          maxLength={4}
          value={form.last4}
          onChange={(e) => setForm({ ...form, last4: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        />
        <select
          value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {form.type === "CREDIT_CARD" && (
          <input
            type="number"
            step="0.01"
            min="0.01"
            placeholder="Credit limit (optional)"
            value={form.creditLimit}
            onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm sm:col-span-5"
          />
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:col-span-5"
        >
          {submitting ? "Adding..." : "Add instrument"}
        </button>
        {error && <p className="text-sm text-red-600 sm:col-span-5">{error}</p>}
      </form>

      {activeInstruments.some((i) => i.type === "CREDIT_CARD") && (
        <Link href="/cards" className="flex items-center justify-between gap-3 rounded-lg border bg-white p-4 text-sm active:bg-gray-50">
          <span>
            <span className="block font-medium">Credit cards</span>
            <span className="block text-gray-500">Statements, what&apos;s owed, due dates, limits and Mark paid are on the Credit cards page.</span>
          </span>
          <span aria-hidden className="text-gray-400">
            ›
          </span>
        </Link>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="p-3">Name</th>
              <th className="p-3">Type</th>
              <th className="p-3">Currency</th>
              <th className="p-3">Balance</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {instruments.map((i) => (
              <Fragment key={i.id}>
              <tr className="border-b last:border-0">
                <td className="p-3">
                  {i.name}
                  {i.last4 && <span className="text-gray-400"> ({i.last4})</span>}
                </td>
                <td className="p-3">{TYPE_LABELS[i.type] ?? i.type}</td>
                <td className="p-3">{i.currency}</td>
                <td className="p-3">
                  {i.type === "CREDIT_CARD" ? (
                    <CardBalance owed={cardOwed.get(i.id)} currency={i.currency} archived={i.archived} />
                  ) : editingBalanceId === i.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.01"
                        autoFocus
                        value={balanceForm.amount}
                        onChange={(e) => setBalanceForm({ ...balanceForm, amount: e.target.value })}
                        className="w-24 rounded border px-2 py-1 text-xs"
                        placeholder={i.type === "CREDIT_CARD" ? "Owed" : "Amount"}
                      />
                      <span className="text-xs text-gray-400">{i.type === "CREDIT_CARD" ? "owed as of" : "as of"}</span>
                      <input
                        type="date"
                        value={balanceForm.date}
                        onChange={(e) => setBalanceForm({ ...balanceForm, date: e.target.value })}
                        className="rounded border px-2 py-1 text-xs"
                      />
                      <button onClick={() => saveBalance(i)} className="text-xs text-brand-600 hover:underline">
                        Save
                      </button>
                      <button onClick={() => setEditingBalanceId(null)} className="text-xs text-gray-400 hover:underline">
                        Cancel
                      </button>
                    </div>
                  ) : i.currentBalance !== null ? (
                    <button onClick={() => startEditingBalance(i)} className="text-left hover:underline">
                      <span className="font-medium">
                        {i.type === "CREDIT_CARD"
                          ? `${i.currentBalance <= 0 ? "Owed" : "Credit"} ${i.currency} ${Math.abs(i.currentBalance).toFixed(2)}`
                          : `${i.currency} ${i.currentBalance.toFixed(2)}`}
                      </span>
                      <span className="ml-1 text-xs text-gray-400">
                        {i.balanceFromTransactionsOnly ? "(from transactions · set starting balance)" : "(edit)"}
                      </span>
                    </button>
                  ) : (
                    <button onClick={() => startEditingBalance(i)} className="text-xs text-brand-600 hover:underline">
                      Set balance
                    </button>
                  )}
                </td>
                <td className="p-3">
                  <span className={i.archived ? "text-gray-400" : "text-income-600"}>
                    {i.archived ? "Archived" : "Active"}
                  </span>
                </td>
                <td className="space-x-3 whitespace-nowrap p-3 text-right">
                  {i.type !== "CASH" && (
                    <button
                      onClick={() => setDetailsId(detailsId === i.id ? null : i.id)}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      {detailsId === i.id ? "Hide details" : "Details"}
                    </button>
                  )}
                  <button onClick={() => toggleArchive(i.id, i.archived)} className="text-xs text-brand-600 hover:underline">
                    {i.archived ? "Unarchive" : "Archive"}
                  </button>
                  <button onClick={() => handleDelete(i.id)} className="text-xs text-red-500 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
              {detailsId === i.id && (
                <tr className="border-b bg-gray-50 last:border-0">
                  <td colSpan={6}>
                    <AccountDetailsPanel instrumentId={i.id} currency={i.currency} type={i.type} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {instruments.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-400">
                  No payment instruments yet — add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        &quot;Set balance&quot; records an amount as of a date (e.g. your savings balance today) — the app then tracks it
        forward using every transaction and transfer touching that instrument from that date on. It doesn&apos;t touch
        activity from before that date.
      </p>

      {/* Transfers -- move money between two instruments without it counting
          as income or an expense (e.g. paying a credit card bill). */}
      <div className="space-y-3 border-t pt-6">
        <div>
          <h2 className="text-lg font-semibold">Transfers</h2>
          <p className="text-sm text-gray-500">
            For moving money between your own accounts — like paying a credit card bill from your bank account.
            This updates both instruments&apos; balances but never shows up as income or an expense, since the actual
            spending was already logged as transactions against the card.
          </p>
        </div>

        {activeInstruments.length < 2 ? (
          <p className="rounded-lg border bg-white p-4 text-sm text-gray-400">
            You need at least two active instruments to log a transfer between them.
          </p>
        ) : (
          <form onSubmit={handleTransferSubmit} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-6">
            <select
              value={transferForm.fromInstrumentId}
              onChange={(e) => setTransferForm({ ...transferForm, fromInstrumentId: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
            >
              <option value="">From...</option>
              {activeInstruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <select
              value={transferForm.toInstrumentId}
              onChange={(e) => setTransferForm({ ...transferForm, toInstrumentId: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
            >
              <option value="">To...</option>
              {activeInstruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="Amount"
              value={transferForm.amount}
              onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm"
            />
            <select
              value={transferForm.currency}
              onChange={(e) => setTransferForm({ ...transferForm, currency: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="date"
              required
              value={transferForm.date}
              onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm sm:col-span-3"
            />
            <input
              type="text"
              placeholder="Notes (optional, e.g. 'Citi Card bill')"
              value={transferForm.notes}
              onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm sm:col-span-3"
            />
            <button
              type="submit"
              disabled={transferSubmitting}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:col-span-6"
            >
              {transferSubmitting ? "Logging..." : "Log transfer"}
            </button>
            {transferError && <p className="text-sm text-red-600 sm:col-span-6">{transferError}</p>}
          </form>
        )}

        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="p-3">Date</th>
                <th className="p-3">From</th>
                <th className="p-3">To</th>
                <th className="p-3">Notes</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="p-3">{formatDate(t.date)}</td>
                  <td className="p-3">{t.fromInstrument.name}</td>
                  <td className="p-3">{t.toInstrument.name}</td>
                  <td className="p-3 text-gray-500">{t.notes || "—"}</td>
                  <td className="p-3 text-right font-medium">
                    {t.currency} {Number(t.amount).toFixed(2)}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDeleteTransfer(t.id)} className="text-xs text-red-500 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {transfers.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-gray-400">
                    No transfers logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="border-t pt-6">
        <h2 className="mb-2 text-lg font-semibold">Last activity on each account</h2>
        <AccountFreshness />
      </div>
    </div>
  );
}

// A card's balance is what its statements say (src/lib/cards.ts), not the
// sum of its charges -- payments would never come off that.
function CardBalance({ owed, currency, archived }: { owed: CardOwed | undefined; currency: string; archived: boolean }) {
  if (archived) return <span className="text-xs text-gray-400">—</span>;
  if (!owed || !owed.hasCycle || owed.owed == null) {
    return (
      <Link href="/cards" className="text-xs text-brand-600 hover:underline">
        Set up on Credit cards
      </Link>
    );
  }
  return (
    <Link href="/cards" className="block hover:underline">
      <span className="font-medium">
        {owed.owed < 0 ? "Credit" : "Owed"} {money(Math.abs(owed.owed), currency)}
      </span>
      <span className="block text-xs text-gray-400">
        {owed.left > 0.005 && owed.due ? `${money(owed.left, currency)} due ${formatDate(owed.due, { month: "short", day: "numeric" })}` : "statement paid"}
      </span>
    </Link>
  );
}
