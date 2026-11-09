"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/formatDate";
import { money } from "@/lib/money";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import type { CardSnapshot, RecordedStatement } from "@/lib/cards";
import MarkCardPaid from "@/components/MarkCardPaid";
import CardUsage from "@/components/CardUsage";

// Each credit card as a statement: what the last statement asked for, what's
// been paid, what's left before the due date, and what's been charged since.
// Built on src/lib/cards.ts; statements typed in here make it exact.

type Card = {
  id: string;
  name: string;
  last4: string | null;
  currency: string;
  statementDay: number | null;
  dueDay: number | null;
  creditLimit: number | null;
  statements: RecordedStatement[];
  snapshot: CardSnapshot;
};

const short = (d: string) => formatDate(d, { month: "short", day: "numeric" });
const long = (d: string) => formatDate(d, { month: "short", day: "numeric", year: "numeric" });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

function dueText(days: number) {
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days < 0) return `${plural(-days, "day")} overdue`;
  return `due in ${plural(days, "day")}`;
}

function StatusPill({ s }: { s: CardSnapshot }) {
  if (!s.hasCycle) return <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">Set closing day</span>;
  const map = {
    PAID: ["bg-green-50 text-income-600", "Paid ✓"],
    NOTHING_DUE: ["bg-gray-100 text-gray-600", "Nothing due"],
    OVERDUE: ["bg-red-50 text-expense-600", dueText(s.daysToDue ?? 0)],
    DUE: [(s.daysToDue ?? 99) <= 5 ? "bg-amber-100 text-amber-800" : "bg-brand-50 text-brand-700", dueText(s.daysToDue ?? 0)],
  } as const;
  const [cls, text] = map[s.status ?? "NOTHING_DUE"];
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{text}</span>;
}

const BASIS_TEXT = {
  RECORDED: "from your statement",
  ROLLED_FORWARD: "worked out from your last statement",
  ESTIMATED: "estimated from transactions",
} as const;

// Overdue first, then by due date, then paid / nothing due, then cards not set up.
function byUrgency(a: Card, b: Card) {
  const rank = (c: Card) =>
    !c.snapshot.hasCycle ? 4 : c.snapshot.status === "OVERDUE" ? 0 : c.snapshot.status === "DUE" ? 1 : c.snapshot.status === "PAID" ? 2 : 3;
  return rank(a) - rank(b) || (a.snapshot.daysToDue ?? 0) - (b.snapshot.daysToDue ?? 0) || a.name.localeCompare(b.name);
}

export default function CardsPage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [today, setToday] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/cards", { cache: "no-store" });
    if (!res.ok) {
      setError("Couldn't load your cards.");
      return;
    }
    const json = await res.json();
    setCards(json.cards);
    setToday(json.today);
  }, []);

  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener(TRANSACTIONS_CHANGED, on);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, on);
  }, [load]);

  if (error) return <p className="text-sm text-expense-600">{error}</p>;
  if (!cards) return <p className="text-sm text-gray-400">Loading...</p>;

  // Totals by currency, and the next payment that needs making.
  const totals = new Map<string, { owed: number; left: number }>();
  for (const c of cards) {
    const t = totals.get(c.currency) ?? { owed: 0, left: 0 };
    t.owed += c.snapshot.outstanding ?? 0;
    t.left += c.snapshot.leftOnStatement;
    totals.set(c.currency, t);
  }
  const nextDue = cards
    .filter((c) => c.snapshot.status === "DUE" || c.snapshot.status === "OVERDUE")
    .sort((a, b) => (a.snapshot.daysToDue ?? 0) - (b.snapshot.daysToDue ?? 0))[0];
  const needsSetup = cards.filter((c) => !c.snapshot.hasCycle).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">Credit cards</h1>
        <p className="text-sm text-gray-500">What each statement asked for, what you&apos;ve paid, and what you owe right now.</p>
      </div>

      {cards.length === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
          No credit cards yet. Add one on <Link href="/instruments" className="text-brand-700 underline">Accounts &amp; cards</Link>.
        </p>
      ) : (
        <section className="grid gap-3 sm:grid-cols-3">
          {[...totals.entries()].map(([cur, t]) => (
            <div key={cur} className="rounded-xl border bg-ink-900 p-4 text-white sm:col-span-1">
              <p className="text-xs uppercase tracking-wide text-ink-300">Owed now{totals.size > 1 ? ` · ${cur}` : ""}</p>
              <p className="font-display mt-1 text-3xl tabular-nums">{money(t.owed, cur)}</p>
              <p className="mt-1 text-xs text-ink-300">
                {t.left > 0.005 ? `${money(t.left, cur)} of it is on statements to pay` : "Every statement is paid"}
              </p>
            </div>
          ))}
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Next payment</p>
            {nextDue ? (
              <>
                <p className="font-display mt-1 text-2xl tabular-nums">{money(nextDue.snapshot.leftOnStatement, nextDue.currency)}</p>
                <p className={`mt-1 text-sm ${nextDue.snapshot.status === "OVERDUE" ? "text-expense-600" : "text-gray-600"}`}>
                  {nextDue.name} · {dueText(nextDue.snapshot.daysToDue ?? 0)} ({short(nextDue.snapshot.statement!.dueDate)})
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-gray-600">Nothing due on any statement.</p>
            )}
          </div>
          {needsSetup > 0 && (
            <div className="rounded-xl border border-dashed bg-white p-4 text-sm text-gray-600">
              {plural(needsSetup, "card")} {needsSetup === 1 ? "needs" : "need"} a statement closing day (it&apos;s on the statement) before
              statements can be worked out.
            </div>
          )}
        </section>
      )}

      <div className="space-y-4">
        {[...cards].sort(byUrgency).map((c) => (
          <CardPanel key={c.id} card={c} today={today} onChanged={load} />
        ))}
      </div>

      <CardUsage />

      <p className="text-xs text-gray-400">
        Payments count once even when both your bank statement and the card statement were imported. Amounts are in each card&apos;s own
        currency; transactions in another currency aren&apos;t counted on the card.
      </p>
    </div>
  );
}

function CardPanel({ card, today, onChanged }: { card: Card; today: string; onChanged: () => void }) {
  const s = card.snapshot;
  const [open, setOpen] = useState<null | "activity" | "history" | "statement" | "settings">(null);
  const [paying, setPaying] = useState(false);
  const toggle = (k: NonNullable<typeof open>) => setOpen((v) => (v === k ? null : k));
  const util = s.utilization;

  return (
    <article className="overflow-hidden rounded-xl border bg-white">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">
            {card.name}
            {card.last4 && <span className="ml-1 text-gray-400">••{card.last4}</span>}
          </h2>
          {card.statementDay && (
            <p className="text-xs text-gray-500">
              Closes on the {ordinal(card.statementDay)}
              {card.dueDay ? ` · due on the ${ordinal(card.dueDay)}` : ""}
            </p>
          )}
        </div>
        <StatusPill s={s} />
      </header>

      {!s.hasCycle ? (
        <div className="space-y-3 p-4 text-sm">
          {(() => {
            const sum = (k: string) => s.recent.filter((a) => a.kind === k).reduce((t, a) => t + a.amount, 0);
            return (
              <p className="text-gray-600">
                Last 30 days: <span className="tabular-nums">{money(sum("CHARGE"), card.currency)}</span> charged ·{" "}
                <span className="tabular-nums text-income-600">{money(sum("PAYMENT"), card.currency)}</span> paid. Add the statement
                closing day to see what&apos;s due.
              </p>
            );
          })()}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => toggle("settings")} className={`min-h-[36px] rounded-md px-3 ${open === "settings" ? "bg-ink-900 text-white" : "bg-brand-600 text-white"}`}>
              Set closing day
            </button>
            <button onClick={() => toggle("statement")} className={`min-h-[36px] rounded-md px-3 ${open === "statement" ? "bg-ink-900 text-white" : "border text-gray-700"}`}>
              Type in a statement
            </button>
            {s.recent.length > 0 && (
              <button onClick={() => toggle("activity")} className={`min-h-[36px] rounded-md px-3 ${open === "activity" ? "bg-ink-900 text-white" : "border text-gray-700"}`}>
                Last 30 days ({s.recent.length})
              </button>
            )}
          </div>
          {open === "settings" && <DaysForm card={card} onSaved={onChanged} />}
          {open === "statement" && <StatementForm card={card} today={today} onSaved={onChanged} />}
          {open === "activity" && <ActivityList card={card} onChanged={onChanged} />}
        </div>
      ) : (
        <>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {/* Owed right now */}
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Owed now</p>
              <p className={`font-display text-3xl tabular-nums ${(s.outstanding ?? 0) < 0 ? "text-income-600" : ""}`}>
                {money(Math.abs(s.outstanding ?? 0), card.currency)}
                {(s.outstanding ?? 0) < -0.005 && <span className="ml-2 align-middle text-sm font-sans">credit</span>}
              </p>
              {util != null && (
                <div className="mt-2">
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${util > 0.5 ? "bg-red-500" : util > 0.3 ? "bg-amber-500" : "bg-green-500"}`}
                      style={{ width: `${Math.min(100, Math.max(0, util * 100))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {Math.round(Math.max(0, util) * 100)}% of the {money(card.creditLimit!, card.currency, 0)} limit used ·{" "}
                    {money(s.available ?? 0, card.currency, 0)} available
                    {util > 0.3 && <span className="text-amber-700"> · above 30% can lower your credit score</span>}
                  </p>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">
                {money(s.statement!.balance, card.currency)} statement − {money(s.paidSinceStatement, card.currency)} paid
                {s.creditsSinceStatement > 0 && ` − ${money(s.creditsSinceStatement, card.currency)} refunds`} +{" "}
                {money(s.chargesSinceStatement, card.currency)} new charges
              </p>
            </div>

            {/* The statement */}
            <div className="rounded-lg bg-paper p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-gray-500">Statement · closed {short(s.statement!.close)}</p>
              </div>
              <dl className="mt-1 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-600">Statement balance</dt>
                  <dd className="tabular-nums font-medium">{money(s.statement!.balance, card.currency)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-600">Paid since</dt>
                  <dd className="tabular-nums text-income-600">{money(s.paidSinceStatement, card.currency)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t pt-1">
                  <dt className="font-medium">Left to pay</dt>
                  <dd className={`tabular-nums font-semibold ${s.status === "OVERDUE" ? "text-expense-600" : ""}`}>
                    {money(s.leftOnStatement, card.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 text-xs text-gray-500">
                  <dt>Due</dt>
                  <dd>
                    {s.statement!.dueDateApprox ? "about " : ""}
                    {long(s.statement!.dueDate)}
                  </dd>
                </div>
                {s.minimumLeft != null && s.leftOnStatement > 0.005 && (
                  <div className="flex justify-between gap-3 text-xs text-gray-500">
                    <dt>Minimum still due</dt>
                    <dd className="tabular-nums">{money(s.minimumLeft, card.currency)}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-2 text-xs text-gray-400">
                Balance {BASIS_TEXT[s.statement!.basis]}.
                {s.statement!.basis !== "RECORDED" && (
                  <>
                    {" "}
                    <button onClick={() => toggle("statement")} className="text-brand-700 underline">
                      Type in the real one
                    </button>
                  </>
                )}
              </p>
              {s.status === "OVERDUE" && (
                <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-expense-600">
                  Past the due date: expect a late fee, and interest on the balance. Pay at least the minimum today.
                </p>
              )}
              {s.status === "DUE" && (
                <p className="mt-2 text-xs text-gray-500">Pay the full {money(s.leftOnStatement, card.currency)} by the due date to avoid interest.</p>
              )}
              {(s.status === "DUE" || s.status === "OVERDUE") && (
                <button
                  onClick={() => setPaying(true)}
                  className="mt-3 w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white active:bg-brand-700"
                >
                  Mark as paid
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t px-4 py-2 text-sm">
            {(
              [
                ["activity", `Since ${short(s.statement!.close)} (${s.recent.length})`],
                ["history", "Past statements"],
                ["statement", "Add statement"],
                ["settings", "Card settings"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => toggle(k)}
                className={`min-h-[36px] rounded-md px-3 ${open === k ? "bg-ink-900 text-white" : "border text-gray-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {open && (
            <div className="border-t p-4">
              {open === "activity" && <ActivityList card={card} onChanged={onChanged} />}
              {open === "history" && <History card={card} onChanged={onChanged} />}
              {open === "statement" && <StatementForm card={card} today={today} onSaved={onChanged} />}
              {open === "settings" && <DaysForm card={card} onSaved={onChanged} />}
            </div>
          )}
          {s.duplicatePayments > 0 && (
            <p className="border-t px-4 py-2 text-xs text-gray-400">
              {plural(s.duplicatePayments, "payment")} appeared on both the bank and the card statement — counted once.
            </p>
          )}
        </>
      )}
      {paying && (
        <MarkCardPaid
          card={card}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            onChanged();
          }}
        />
      )}
    </article>
  );
}

function ActivityList({ card, onChanged }: { card: Card; onChanged?: () => void }) {
  async function undo(transferId: string) {
    if (!confirm("Remove this payment? The bill will show as unpaid again.")) return;
    await fetch(`/api/transfers/${transferId}`, { method: "DELETE" });
    onChanged?.();
  }
  const rows = card.snapshot.recent;
  if (!rows.length) return <p className="text-sm text-gray-400">Nothing since the statement closed.</p>;
  return (
    <ul className="divide-y text-sm">
      {rows.map((a, i) => (
        <li key={i} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0">
            <span className="block truncate">{a.label}</span>
            <span className="block text-xs text-gray-500">
              {short(a.date)} · {a.kind === "CHARGE" ? "charge" : a.kind === "PAYMENT" ? "payment" : "refund / credit"}
              {a.transferId && onChanged && (
                <>
                  {" · "}
                  <button onClick={() => undo(a.transferId!)} className="text-expense-600 underline">
                    undo
                  </button>
                </>
              )}
            </span>
          </span>
          <span className={`shrink-0 tabular-nums ${a.kind === "CHARGE" ? "" : "text-income-600"}`}>
            {a.kind === "CHARGE" ? "" : "−"}
            {money(a.amount, card.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function History({ card, onChanged }: { card: Card; onChanged: () => void }) {
  async function remove(id: string) {
    if (!confirm("Delete this statement? The page will go back to working it out from transactions.")) return;
    await fetch(`/api/cards/statements/${id}`, { method: "DELETE" });
    onChanged();
  }
  const recordedIds = new Map(card.statements.map((s) => [s.closingDate, s.id]));
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Each billing cycle: what you charged, what came back, and what you paid during it.</p>
      <ul className="divide-y text-sm">
        {card.snapshot.cycles.map((c) => (
          <li key={c.close} className="flex items-start justify-between gap-3 py-2">
            <span>
              <span className="block">
                {short(c.start)} – {short(c.close)}
              </span>
              <span className="block text-xs text-gray-500">
                {c.statementBalance != null ? `Statement ${money(c.statementBalance, card.currency)}` : "No statement typed in"}
                {recordedIds.has(c.close) && (
                  <>
                    {" · "}
                    <button onClick={() => remove(recordedIds.get(c.close)!)} className="text-expense-600 underline">
                      delete
                    </button>
                  </>
                )}
              </span>
            </span>
            <span className="shrink-0 text-right tabular-nums">
              <span className="block">{money(c.charges - c.credits, card.currency)} spent</span>
              <span className="block text-xs text-income-600">{money(c.payments, card.currency)} paid</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatementForm({ card, today, onSaved }: { card: Card; today: string; onSaved: () => void }) {
  const s = card.snapshot;
  const [closingDate, setClosingDate] = useState(s.statement?.close ?? today);
  const [balance, setBalance] = useState("");
  const [minimumDue, setMinimumDue] = useState("");
  const [dueDate, setDueDate] = useState(s.statement && !s.statement.dueDateApprox ? s.statement.dueDate : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const b = Number(balance.replace(/[,$₹\s]/g, ""));
    if (!balance.trim() || !Number.isFinite(b)) return setErr("Enter the statement balance.");
    const m = minimumDue.trim() ? Number(minimumDue.replace(/[,$₹\s]/g, "")) : null;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/cards/statements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrumentId: card.id, closingDate, balance: b, minimumDue: m, dueDate: dueDate || null }),
    });
    setBusy(false);
    if (!res.ok) return setErr((await res.json().catch(() => null))?.error ?? "Couldn't save.");
    setBalance("");
    setMinimumDue("");
    onSaved();
  }

  return (
    <form onSubmit={save} className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <p className="col-span-2 text-xs text-gray-500 sm:col-span-4">
        From the top of your statement. Typing in the same closing date again replaces it.
      </p>
      <label className="col-span-1">
        <span className="mb-1 block text-xs text-gray-500">Closing date</span>
        <input type="date" value={closingDate} max={today} onChange={(e) => setClosingDate(e.target.value)} className="w-full rounded-md border px-3 py-2" required />
      </label>
      <label className="col-span-1">
        <span className="mb-1 block text-xs text-gray-500">New balance</span>
        <input inputMode="decimal" placeholder="0.00" value={balance} onChange={(e) => setBalance(e.target.value)} className="w-full rounded-md border px-3 py-2" />
      </label>
      <label className="col-span-1">
        <span className="mb-1 block text-xs text-gray-500">Minimum due</span>
        <input inputMode="decimal" placeholder="optional" value={minimumDue} onChange={(e) => setMinimumDue(e.target.value)} className="w-full rounded-md border px-3 py-2" />
      </label>
      <label className="col-span-1">
        <span className="mb-1 block text-xs text-gray-500">Payment due</span>
        <input type="date" value={dueDate} min={closingDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-md border px-3 py-2" />
      </label>
      <button disabled={busy} className="col-span-2 rounded-md bg-brand-600 px-4 py-2.5 font-medium text-white disabled:opacity-50 sm:col-span-1">
        {busy ? "Saving..." : "Save statement"}
      </button>
      {err && <p className="col-span-2 text-expense-600 sm:col-span-3">{err}</p>}
    </form>
  );
}

function DaysForm({ card, onSaved }: { card: Card; onSaved: () => void }) {
  const [statementDay, setStatementDay] = useState(card.statementDay ? String(card.statementDay) : "");
  const [dueDay, setDueDay] = useState(card.dueDay ? String(card.dueDay) : "");
  const [limit, setLimit] = useState(card.creditLimit ? String(card.creditLimit) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const l = limit.trim() ? Number(limit.replace(/[,$₹\s]/g, "")) : null;
    if (l !== null && (!Number.isFinite(l) || l <= 0)) return setErr("The limit should be a positive amount.");
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/instruments/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statementDay: statementDay ? Number(statementDay) : null, dueDay: dueDay ? Number(dueDay) : null, creditLimit: l }),
    });
    setBusy(false);
    if (!res.ok) return setErr("Couldn't save.");
    onSaved();
  }

  return (
    <form onSubmit={save} className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <label>
        <span className="mb-1 block text-xs text-gray-500">Statement closes on</span>
        <select value={statementDay} onChange={(e) => setStatementDay(e.target.value)} className="w-full rounded-md border px-3 py-2">
          <option value="">Day…</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {ordinal(d)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-500">Payment due on</span>
        <select value={dueDay} onChange={(e) => setDueDay(e.target.value)} className="w-full rounded-md border px-3 py-2">
          <option value="">Day…</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {ordinal(d)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-500">Credit limit</span>
        <input inputMode="decimal" placeholder="optional" value={limit} onChange={(e) => setLimit(e.target.value)} className="w-full rounded-md border px-3 py-2" />
      </label>
      <button disabled={busy} className="self-end rounded-md bg-brand-600 px-4 py-2.5 font-medium text-white disabled:opacity-50">
        {busy ? "Saving..." : "Save"}
      </button>
      {err && <p className="col-span-2 text-expense-600 sm:col-span-4">{err}</p>}
    </form>
  );
}
