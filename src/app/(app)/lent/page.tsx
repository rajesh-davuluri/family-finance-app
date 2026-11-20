"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/money";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import { REMIND_AFTER_DAYS, daysSince, reminderText, type LoanEntry } from "@/lib/personalLoans";
import type { Person, Unlinked } from "@/lib/personalLoanData";

// Lent & borrowed: money between the household and friends or family, by
// person. Each balance is worked out from the transactions linked to that
// person (money out adds to what they owe you, money in takes it off), plus
// anything owed before the app's records. Transactions in a loan category,
// or whose note reads like a loan, wait below to be linked to someone.

type Data = { today: string; people: Person[]; unlinked: Unlinked[] };
type Account = { id: string; name: string; type: string; archived: boolean };

const usd = (n: number, d = 2) => money(n, "USD", d);
const day = (d: string) => formatDate(d, { month: "short", day: "numeric", year: "numeric" });
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function owesLine(p: { name: string; balanceUsd: number }) {
  if (p.balanceUsd > 0) return `${p.name.split(/\s+/)[0]} owes you ${usd(p.balanceUsd)}`;
  if (p.balanceUsd < 0) return `You owe ${p.name.split(/\s+/)[0]} ${usd(-p.balanceUsd)}`;
  return "Settled";
}

export default function LentPage() {
  const [data, setData] = useState<Data | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showSettled, setShowSettled] = useState(false);

  const load = useCallback(() => {
    fetch("/api/lent", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    load();
    fetch("/api/instruments")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Account[]) => setAccounts(list.filter((a) => !a.archived)))
      .catch(() => setAccounts([]));
  }, [load]);

  if (error) return <p className="text-sm text-expense-600">Couldn&apos;t load Lent &amp; borrowed. Try again in a moment.</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading...</p>;

  const open = data.people.filter((p) => p.balanceUsd !== 0).sort((a, b) => Math.abs(b.balanceUsd) - Math.abs(a.balanceUsd));
  const settled = data.people.filter((p) => p.balanceUsd === 0);
  const owedToYou = open.filter((p) => p.balanceUsd > 0).reduce((s, p) => s + p.balanceUsd, 0);
  const youOwe = -open.filter((p) => p.balanceUsd < 0).reduce((s, p) => s + p.balanceUsd, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Lent &amp; borrowed</h1>
          <p className="text-sm text-gray-500">Money between you and friends or family: who owes whom, and since when.</p>
        </div>
        <button onClick={() => setAdding(!adding)} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          {adding ? "Cancel" : "Add a person"}
        </button>
      </div>

      {adding && (
        <PersonForm
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      <section aria-label="Totals" className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-ink-900 p-4 text-white shadow-sm">
          <p className="text-xs uppercase tracking-wide text-ink-300">Owed to you</p>
          <p className="font-display mt-1 text-3xl tabular-nums text-brand-300">{usd(owedToYou)}</p>
          <p className="text-sm text-ink-300">{open.filter((p) => p.balanceUsd > 0).length} people</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">You owe</p>
          <p className={`font-display mt-1 text-3xl tabular-nums ${youOwe > 0 ? "text-expense-600" : ""}`}>{usd(youOwe)}</p>
          <p className="text-sm text-gray-500">{open.filter((p) => p.balanceUsd < 0).length} people</p>
        </div>
      </section>

      {open.length === 0 && data.unlinked.length === 0 && (
        <p className="rounded-xl border bg-white p-4 text-sm text-gray-500">
          Nothing owed either way. Log a loan in a loan category (such as &ldquo;Money Lent&rdquo; or &ldquo;Hand Loan&rdquo;), or add a person above.
        </p>
      )}

      {open.map((p) => (
        <PersonCard key={p.id} person={p} today={data.today} accounts={accounts} onChanged={load} />
      ))}

      {data.unlinked.length > 0 && <UnlinkedList rows={data.unlinked} people={data.people} onChanged={load} />}

      {settled.length > 0 && (
        <section>
          <button onClick={() => setShowSettled(!showSettled)} className="text-sm text-gray-500 underline">
            {showSettled ? "Hide" : "Show"} {settled.length} settled {settled.length === 1 ? "person" : "people"}
          </button>
          {showSettled && (
            <div className="mt-3 space-y-3">
              {settled.map((p) => (
                <PersonCard key={p.id} person={p} today={data.today} accounts={accounts} onChanged={load} />
              ))}
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-gray-500">
        Amounts are in approximate US dollars. Money you send a person (lending, or paying back what you borrowed) adds to what they owe you; money they send you takes it
        off. These count as neither income nor spending, and what&apos;s owed each way is part of your net worth.
      </p>
    </div>
  );
}

function PersonCard({ person: p, today, accounts, onChanged }: { person: Person; today: string; accounts: Account[]; onChanged: () => void }) {
  const [panel, setPanel] = useState<null | "IN" | "OUT" | "history" | "edit">(null);
  const [copied, setCopied] = useState(false);
  const age = p.since ? daysSince(p.since, today) : null;
  const overdue = p.balanceUsd > 0 && age != null && age >= REMIND_AFTER_DAYS;

  async function copyReminder() {
    const text = reminderText(p.name, p.balanceUsd, p.since);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Copy this message:", text);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${p.name}? Their transactions stay, just no longer linked to anyone.`)) return;
    await fetch(`/api/lent/${p.id}`, { method: "DELETE" });
    onChanged();
  }

  const toggle = (k: NonNullable<typeof panel>) => setPanel((v) => (v === k ? null : k));
  return (
    <article className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{p.name}</h2>
          <p className="text-xs text-gray-500">
            {p.balanceUsd !== 0 && p.since ? `Since ${day(p.since)}${age != null ? ` · ${age} day${age === 1 ? "" : "s"}` : ""}` : p.lastDate ? `Last ${day(p.lastDate)}` : "No transactions yet"}
          </p>
        </div>
        <div className="text-right">
          <p className={`font-display text-xl tabular-nums ${p.balanceUsd > 0 ? "text-income-600" : p.balanceUsd < 0 ? "text-expense-600" : "text-gray-400"}`}>
            {p.balanceUsd === 0 ? usd(0) : usd(Math.abs(p.balanceUsd))}
          </p>
          <p className={`text-xs ${overdue ? "font-medium text-amber-700" : "text-gray-500"}`}>{owesLine(p)}</p>
        </div>
      </header>
      <div className="flex flex-wrap gap-2 border-t px-4 py-2 text-sm">
        <button onClick={() => toggle("IN")} className={`min-h-[34px] rounded-md px-3 ${panel === "IN" ? "bg-ink-900 text-white" : "border text-gray-700"}`}>
          They paid me
        </button>
        <button onClick={() => toggle("OUT")} className={`min-h-[34px] rounded-md px-3 ${panel === "OUT" ? "bg-ink-900 text-white" : "border text-gray-700"}`}>
          I paid them
        </button>
        <button onClick={() => toggle("history")} className={`min-h-[34px] rounded-md px-3 ${panel === "history" ? "bg-ink-900 text-white" : "border text-gray-700"}`}>
          History ({p.entries.length}
          {p.openingUsd !== 0 ? " + earlier" : ""})
        </button>
        {p.balanceUsd > 0 && (
          <button onClick={copyReminder} className="min-h-[34px] rounded-md border px-3 text-gray-700">
            {copied ? "Copied ✓" : "Copy reminder"}
          </button>
        )}
        <button onClick={() => toggle("edit")} className={`min-h-[34px] rounded-md px-3 ${panel === "edit" ? "bg-ink-900 text-white" : "text-gray-500"}`}>
          Edit
        </button>
      </div>
      {overdue && panel === null && (
        <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Outstanding for {age} days. &ldquo;Copy reminder&rdquo; gives you a friendly message to send.
        </p>
      )}
      {(panel === "IN" || panel === "OUT") && (
        <PaymentForm
          person={p}
          way={panel}
          accounts={accounts}
          onSaved={() => {
            setPanel(null);
            onChanged();
          }}
        />
      )}
      {panel === "history" && <History person={p} onChanged={onChanged} />}
      {panel === "edit" && (
        <div className="border-t p-4">
          <PersonForm
            person={p}
            onSaved={() => {
              setPanel(null);
              onChanged();
            }}
          />
          <button onClick={remove} className="mt-2 text-xs text-expense-600 underline">
            Remove {p.name}
          </button>
        </div>
      )}
    </article>
  );
}

function PaymentForm({ person, way, accounts, onSaved }: { person: Person; way: "IN" | "OUT"; accounts: Account[]; onSaved: () => void }) {
  const suggested = way === "IN" ? Math.max(0, person.balanceUsd) : Math.max(0, -person.balanceUsd);
  const [amount, setAmount] = useState(suggested ? String(suggested) : "");
  const [instrumentId, setInstrumentId] = useState("");
  const [date, setDate] = useState(getTodayLocal());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const first = person.name.split(/\s+/)[0];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(amount.replace(/[,$\s]/g, ""));
    if (!(v > 0)) return setErr("Enter the amount.");
    if (!instrumentId) return setErr(way === "IN" ? "Choose the account it went into." : "Choose the account it came from.");
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/lent/${person.id}/payment`, json("POST", { way, amount: v, instrumentId, date, notes: notes.trim() || undefined }));
    setBusy(false);
    if (!res.ok) return setErr((await res.json().catch(() => null))?.error ?? "Couldn't save it.");
    onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-2 border-t bg-paper p-4 text-sm">
      <p className="text-xs text-gray-600">
        {way === "IN"
          ? `Money from ${first}: a repayment, or money you borrowed. It comes off what they owe you, or adds to what you owe them.`
          : `Money to ${first}: lending, or paying back what you borrowed. It adds to what they owe you.`}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-gray-600">
          Amount
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 block w-28 rounded border bg-white px-2 py-1.5 text-base font-normal tabular-nums" />
        </label>
        <label className="text-xs font-medium text-gray-600">
          {way === "IN" ? "Into" : "From"}
          <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} className="mt-1 block rounded border bg-white px-2 py-1.5 text-base font-normal">
            <option value="">Choose account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block rounded border bg-white px-2 py-1.5 text-base font-normal" />
        </label>
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" maxLength={500} className="w-full rounded border bg-white px-2 py-1.5" />
      {err && <p className="text-xs text-expense-600">{err}</p>}
      <button type="submit" disabled={busy} className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "Saving…" : way === "IN" ? `Record money from ${first}` : `Record money to ${first}`}
      </button>
    </form>
  );
}

function History({ person, onChanged }: { person: Person; onChanged: () => void }) {
  async function unlink(e: LoanEntry) {
    if (!confirm("Unlink this transaction from " + person.name + "? The transaction itself stays.")) return;
    await fetch("/api/lent/link", json("POST", { transactionId: e.id, contactId: null }));
    onChanged();
  }
  return (
    <div className="border-t px-4 py-3">
      <ul className="divide-y text-sm">
        {person.entries.map((e) => (
          <li key={e.id} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="min-w-0">
              <span className="block truncate">{e.notes || e.label}</span>
              <span className="block text-xs text-gray-500">
                {day(e.date)} · {e.label} · {e.account}
                {e.countsAsSpending && <span className="text-amber-700"> · its category counts it as {e.amountUsd > 0 ? "spending" : "income"}</span>}
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-3">
              <span className={`tabular-nums ${e.amountUsd < 0 ? "text-income-600" : ""}`}>{e.amountUsd > 0 ? `to them ${usd(e.amountUsd)}` : `from them ${usd(-e.amountUsd)}`}</span>
              <button onClick={() => unlink(e)} className="text-xs text-gray-400 hover:underline">
                unlink
              </button>
            </span>
          </li>
        ))}
        {person.openingUsd !== 0 && (
          <li className="flex justify-between gap-3 py-1.5 text-gray-600">
            <span>Owed before these records{person.openingDate ? ` (as of ${day(person.openingDate)})` : ""}</span>
            <span className="tabular-nums">{person.openingUsd > 0 ? `they owed you ${usd(person.openingUsd)}` : `you owed ${usd(-person.openingUsd)}`}</span>
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-gray-500">
        In all: {usd(person.lentUsd)} to them, {usd(person.receivedUsd)} from them.
      </p>
    </div>
  );
}

function PersonForm({ person, onSaved }: { person?: Person; onSaved: () => void }) {
  const [name, setName] = useState(person?.name ?? "");
  const [owed, setOwed] = useState(person && person.openingUsd ? String(Math.abs(person.openingUsd)) : "");
  const [side, setSide] = useState<"THEY" | "YOU">(person && person.openingUsd < 0 ? "YOU" : "THEY");
  const [asOf, setAsOf] = useState(person?.openingDate ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amount = owed.trim() ? Number(owed.replace(/[,$\s]/g, "")) : 0;
    if (!name.trim()) return setErr("Give the person a name.");
    if (!Number.isFinite(amount) || amount < 0) return setErr("Check the amount owed.");
    setBusy(true);
    setErr(null);
    const body = { name: name.trim(), openingBalance: side === "THEY" ? amount : -amount, openingDate: amount && asOf ? asOf : null, phone: phone.trim() || null, notes: notes.trim() || null };
    const res = await fetch(person ? `/api/lent/${person.id}` : "/api/lent", json(person ? "PUT" : "POST", body));
    setBusy(false);
    if (!res.ok) return setErr((await res.json().catch(() => null))?.error ?? "Couldn't save.");
    onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border bg-white p-4 text-sm shadow-sm">
      <label className="block text-xs font-medium text-gray-600">
        Name
        <input autoFocus={!person} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Janardan Bhatt" className="mt-1 block w-full rounded border px-2 py-1.5 text-base font-normal" />
      </label>
      <div>
        <p className="text-xs font-medium text-gray-600">Owed before your records in the app (optional)</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select value={side} onChange={(e) => setSide(e.target.value as "THEY" | "YOU")} className="rounded border bg-white px-2 py-1.5">
            <option value="THEY">They owed me</option>
            <option value="YOU">I owed them</option>
          </select>
          <span className="flex items-center gap-1 rounded border px-2">
            <span className="text-gray-400">$</span>
            <input inputMode="decimal" value={owed} onChange={(e) => setOwed(e.target.value)} placeholder="0" className="w-24 py-1.5 text-base tabular-nums outline-none" />
          </span>
          <span className="text-xs text-gray-500">as of</span>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="rounded border px-2 py-1.5" />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" maxLength={50} className="rounded border px-2 py-1.5" />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" maxLength={1000} className="rounded border px-2 py-1.5" />
      </div>
      {err && <p className="text-xs text-expense-600">{err}</p>}
      <button type="submit" disabled={busy} className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "Saving…" : person ? "Save" : "Add person"}
      </button>
    </form>
  );
}

function UnlinkedList({ rows, people, onChanged }: { rows: Unlinked[]; people: Person[]; onChanged: () => void }) {
  return (
    <section aria-label="Not linked to anyone yet" className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="font-display text-lg">Not linked to anyone yet</h2>
      <p className="text-sm text-gray-500">Transactions in a loan category, or whose note reads like money between people. Link each to the person it was with.</p>
      <ul className="mt-2 divide-y text-sm">
        {rows.map((r) => (
          <UnlinkedRow key={r.id} row={r} people={people} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}

function UnlinkedRow({ row: r, people, onChanged }: { row: Unlinked; people: Person[]; onChanged: () => void }) {
  const initial = r.suggestion ? (r.suggestion.existing ? people.find((p) => p.name === r.suggestion!.name)?.id ?? "" : "__new") : "";
  const [choice, setChoice] = useState(initial);
  const [newName, setNewName] = useState(r.suggestion && !r.suggestion.existing ? r.suggestion.name : "");
  const [busy, setBusy] = useState(false);

  async function link() {
    if (!choice) return;
    if (choice === "__new" && !newName.trim()) return;
    setBusy(true);
    await fetch("/api/lent/link", json("POST", choice === "__new" ? { transactionId: r.id, newName: newName.trim() } : { transactionId: r.id, contactId: choice }));
    setBusy(false);
    onChanged();
  }

  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate">{r.notes || r.label}</span>
          <span className="block text-xs text-gray-500">
            {day(r.date)} · {r.label} · {r.account}
            {r.countsAsSpending && <span className="text-amber-700"> · counted as {r.amountUsd > 0 ? "spending" : "income"}: consider a loan category</span>}
          </span>
        </span>
        <span className={`shrink-0 tabular-nums ${r.amountUsd < 0 ? "text-income-600" : ""}`}>{r.amountUsd > 0 ? `out ${usd(r.amountUsd)}` : `in ${usd(-r.amountUsd)}`}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className="rounded border bg-white px-2 py-1 text-sm">
          <option value="">Link to…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="__new">New person…</option>
        </select>
        {choice === "__new" && <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className="rounded border px-2 py-1 text-sm" />}
        <button onClick={link} disabled={busy || !choice || (choice === "__new" && !newName.trim())} className="rounded-md border border-brand-600 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40">
          Link
        </button>
        {r.suggestion && <span className="text-xs text-gray-400">suggested from the note</span>}
      </div>
    </li>
  );
}
