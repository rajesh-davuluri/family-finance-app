"use client";

import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import { formatDate, getTodayLocal } from "@/lib/formatDate";

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
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "BANK_ACCOUNT", last4: "", currency: "USD", creditLimit: "" });
  const [submitting, setSubmitting] = useState(false);

  // Which instrument's balance is currently being edited, if any.
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
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
    const [instRes, transferRes] = await Promise.all([fetch("/api/instruments"), fetch("/api/transfers")]);
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

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-5">
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

      <CreditCardLimits
        cards={activeInstruments.filter((i) => i.type === "CREDIT_CARD")}
        onChanged={load}
      />

      <div className="rounded-lg border bg-white">
        <table className="w-full text-sm">
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
              <tr key={i.id} className="border-b last:border-0">
                <td className="p-3">
                  {i.name}
                  {i.last4 && <span className="text-gray-400"> ({i.last4})</span>}
                </td>
                <td className="p-3">{TYPE_LABELS[i.type] ?? i.type}</td>
                <td className="p-3">{i.currency}</td>
                <td className="p-3">
                  {editingBalanceId === i.id ? (
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
                      <span className="ml-1 text-xs text-gray-400">(edit)</span>
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
                <td className="space-x-3 p-3 text-right">
                  <button onClick={() => toggleArchive(i.id, i.archived)} className="text-xs text-brand-600 hover:underline">
                    {i.archived ? "Unarchive" : "Archive"}
                  </button>
                  <button onClick={() => handleDelete(i.id)} className="text-xs text-red-500 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
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
        "Set balance" records an amount as of a date (e.g. your savings balance today) — the app then tracks it
        forward using every transaction and transfer touching that instrument from that date on. It doesn't touch
        activity from before that date.
      </p>

      {/* Transfers -- move money between two instruments without it counting
          as income or an expense (e.g. paying a credit card bill). */}
      <div className="space-y-3 border-t pt-6">
        <div>
          <h2 className="text-lg font-semibold">Transfers</h2>
          <p className="text-sm text-gray-500">
            For moving money between your own accounts — like paying a credit card bill from your bank account.
            This updates both instruments' balances but never shows up as income or an expense, since the actual
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

        <div className="rounded-lg border bg-white">
          <table className="w-full text-sm">
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
    </div>
  );
}

function money(currency: string, n: number) {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Utilization bands match the usual credit-score guidance: under 30% is
// healthy, 30-70% is worth watching, above 70% is high.
function utilizationColor(pct: number) {
  if (pct < 30) return "bg-income-500";
  if (pct < 70) return "bg-brand-400";
  return "bg-expense-500";
}

function CreditCardLimits({ cards, onChanged }: { cards: Instrument[]; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  if (cards.length === 0) return null;

  async function saveLimit(id: string) {
    const value = limitInput.trim() === "" ? null : parseFloat(limitInput);
    if (value !== null && (isNaN(value) || value <= 0)) {
      setSaveError("Enter a limit greater than zero, or leave it empty to clear it.");
      return;
    }
    const res = await fetch(`/api/instruments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creditLimit: value }),
    });
    if (!res.ok) {
      setSaveError("Couldn't save that limit.");
      return;
    }
    setSaveError(null);
    setEditingId(null);
    onChanged();
  }

  // Owed = the negative part of the balance; a positive balance is a credit
  // (e.g. a refund or overpayment), which uses none of the limit.
  const rows = cards.map((c) => {
    const limit = c.creditLimit !== null ? Number(c.creditLimit) : null;
    const owed = c.currentBalance !== null ? Math.max(0, -c.currentBalance) : null;
    const available = limit !== null && owed !== null ? limit - owed : null;
    const pct = limit !== null && owed !== null && limit > 0 ? (owed / limit) * 100 : null;
    return { card: c, limit, owed, available, pct };
  });

  // Totals only make sense within one currency.
  const totals = new Map<string, { limit: number; owed: number }>();
  for (const r of rows) {
    if (r.limit === null || r.owed === null) continue;
    const t = totals.get(r.card.currency) ?? { limit: 0, owed: 0 };
    t.limit += r.limit;
    t.owed += r.owed;
    totals.set(r.card.currency, t);
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Credit cards</h2>
        <p className="text-sm text-gray-500">
          Limit, how much is used (what you currently owe), and what&apos;s still available on each card.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map(({ card, limit, owed, available, pct }) => (
          <div key={card.id} className="space-y-2 rounded-lg border bg-white p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">
                {card.name}
                {card.last4 && <span className="text-gray-400"> ({card.last4})</span>}
              </span>
              {editingId === card.id ? (
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    autoFocus
                    value={limitInput}
                    onChange={(e) => setLimitInput(e.target.value)}
                    className="w-28 rounded border px-2 py-1 text-xs"
                    placeholder="Limit"
                  />
                  <button onClick={() => saveLimit(card.id)} className="text-xs text-brand-600 hover:underline">
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setSaveError(null);
                    }}
                    className="text-xs text-gray-400 hover:underline"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => {
                    setLimitInput(limit !== null ? String(limit) : "");
                    setSaveError(null);
                    setEditingId(card.id);
                  }}
                  className="text-xs text-brand-600 hover:underline"
                >
                  {limit !== null ? `Limit ${money(card.currency, limit)} (edit)` : "Set limit"}
                </button>
              )}
            </div>
            {editingId === card.id && saveError && <p className="text-xs text-red-600">{saveError}</p>}

            {owed === null ? (
              <p className="text-xs text-gray-400">
                Set this card&apos;s balance (amount owed) in the table below to see how much is used.
              </p>
            ) : limit === null ? (
              <p className="text-sm text-gray-600">
                Used <span className="font-medium">{money(card.currency, owed)}</span>
                <span className="text-xs text-gray-400"> — set a limit to see what&apos;s remaining.</span>
              </p>
            ) : (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={`h-full ${utilizationColor(pct!)}`}
                    style={{ width: `${Math.min(100, pct!)}%` }}
                  />
                </div>
                <div className="grid grid-cols-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Used</div>
                    <div className="font-medium">{money(card.currency, owed)}</div>
                    <div className="text-xs text-gray-400">{pct!.toFixed(0)}% of limit</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{available! < 0 ? "Over limit by" : "Remaining"}</div>
                    <div className={`font-medium ${available! < 0 ? "text-expense-600" : "text-income-600"}`}>
                      {money(card.currency, Math.abs(available!))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Limit</div>
                    <div className="font-medium">{money(card.currency, limit)}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {totals.size > 0 && (
        <div className="rounded-lg border bg-white p-4 text-sm">
          {Array.from(totals.entries()).map(([currency, t]) => {
            const pct = t.limit > 0 ? (t.owed / t.limit) * 100 : 0;
            return (
              <p key={currency}>
                <span className="font-medium">All cards ({currency}):</span> used {money(currency, t.owed)} of{" "}
                {money(currency, t.limit)} ({pct.toFixed(0)}%) — {money(currency, t.limit - t.owed)} remaining
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
