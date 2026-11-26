"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/money";
import { gapWords } from "@/lib/balanceCheck";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import type { Hint } from "@/lib/balanceCheck";
import type { CloseAccount } from "@/lib/periodCloseData";

// Monthly close: each period, every bank account and credit card is checked
// against the bank's or card's own figure and closed. A difference can be
// accepted as a recorded balance adjustment (up to the household's
// tolerance as it is, above it with a note), so nothing is smoothed over
// out of sight. The latest close is re-tested each time the page loads.

type Data = { today: string; toleranceUsd: number; accounts: CloseAccount[] };
type Result =
  | { status: "CLOSED"; asOfDate: string; figure: number; app: number; diff: number; adjustment: number }
  | { status: "OFF"; asOfDate: string; figure: number; app: number; diff: number; within: boolean; toleranceUsd: number; hints: Hint[] };

const day = (d: string) => formatDate(d, { month: "short", day: "numeric", year: "numeric" });
const when = (iso: string) => formatDate(iso.slice(0, 10), { month: "short", day: "numeric", year: "numeric" });
const num = (s: string) => Number(s.replace(/[,$₹€£\s]/g, ""));

const STATUS: Record<CloseAccount["status"], [string, string]> = {
  CLOSED: ["bg-green-50 text-income-600", "Closed ✓"],
  DUE: ["bg-amber-100 text-amber-800", "To close"],
  CHANGED: ["bg-red-50 text-expense-600", "Changed after close"],
  NOT_DUE: ["bg-gray-100 text-gray-600", "Nothing to close yet"],
  UNAVAILABLE: ["bg-gray-100 text-gray-600", "Set up first"],
};

export default function ClosePage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [tolEdit, setTolEdit] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/close", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function saveTolerance() {
    const v = tolEdit == null ? NaN : num(tolEdit);
    if (!data || !Number.isFinite(v) || v < 0) return;
    setData({ ...data, toleranceUsd: v });
    setTolEdit(null);
    await fetch("/api/close", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toleranceUsd: v }) });
  }

  if (error) return <p className="text-sm text-expense-600">Couldn&apos;t load the monthly close. Try again in a moment.</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading...</p>;

  const open = data.accounts.filter((a) => a.status === "DUE" || a.status === "CHANGED");
  const closable = data.accounts.filter((a) => a.status !== "UNAVAILABLE" && a.status !== "NOT_DUE");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl">Monthly close</h1>
        <p className="text-sm text-gray-500">
          Each period, check every account against the bank or card and close it. Bank accounts close by calendar month; cards by statement.
        </p>
      </div>

      <section aria-label="Summary" className="rounded-xl bg-ink-900 p-4 text-white shadow-sm">
        <p className="text-xs uppercase tracking-wide text-ink-300">This period</p>
        <p className="font-display mt-1 text-3xl">
          {closable.length - open.length} of {closable.length} closed
        </p>
        <p className="mt-1 text-sm text-ink-300">
          {open.length === 0 ? "Every account matches its bank or card for its latest period." : `Still to close: ${open.map((a) => a.name).join(", ")}.`}
        </p>
        <p className="mt-3 border-t border-white/15 pt-2 text-sm text-ink-300">
          Differences up to{" "}
          {tolEdit == null ? (
            <button onClick={() => setTolEdit(String(data.toleranceUsd))} className="font-medium text-white underline decoration-white/40">
              {money(data.toleranceUsd, "USD", 0)}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-white">
              $
              <input
                autoFocus
                inputMode="decimal"
                value={tolEdit}
                onChange={(e) => setTolEdit(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveTolerance()}
                className="w-16 rounded border border-white/30 bg-transparent px-1.5 py-0.5 text-right text-base"
                aria-label="Tolerance"
              />
              <button onClick={saveTolerance} className="rounded bg-brand-600 px-2 py-0.5 text-xs">
                Save
              </button>
            </span>
          )}{" "}
          can be accepted as a recorded adjustment. Above that, a note saying why is required.
        </p>
      </section>

      {data.accounts.length === 0 && (
        <p className="rounded-xl border bg-white p-4 text-sm text-gray-500">
          No bank accounts or cards yet. Add them on <Link href="/instruments" className="underline">Accounts &amp; cards</Link>.
        </p>
      )}

      {data.accounts.map((a) => (
        <AccountClose key={a.id} account={a} today={data.today} onChanged={load} />
      ))}

      <p className="text-xs text-gray-500">
        An accepted difference is saved as a transaction in &ldquo;Balance adjustment (in)&rdquo; or &ldquo;(out)&rdquo; on that account, dated the last day of the period. It
        counts as neither income nor spending, and undoing the close deletes it. Each account&apos;s latest close is re-checked every time this page opens: if an entry in a
        closed period is changed or deleted, it shows as &ldquo;Changed after close&rdquo;.
      </p>
    </div>
  );
}

function AccountClose({ account: a, today, onChanged }: { account: CloseAccount; today: string; onChanged: () => void }) {
  const card = a.kind === "CARD";
  const [open, setOpen] = useState(a.status === "DUE" || a.status === "CHANGED");
  const [showHistory, setShowHistory] = useState(false);
  const defaultDate = a.status === "DUE" && a.dueEnd ? a.dueEnd : getTodayLocal() > today ? today : getTodayLocal();
  const [date, setDate] = useState(defaultDate);
  const [figure, setFigure] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [cls, label] = STATUS[a.status];

  async function submit(accept = false) {
    const v = num(figure);
    if (figure.trim() === "" || !Number.isFinite(v)) return setErr(card ? "Enter what the card says is owed." : "Enter the balance the bank shows.");
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/close/${a.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asOfDate: date, figure: v, accept, note: note.trim() || undefined }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !body) return setErr(typeof body?.error === "string" ? body.error : "Couldn't close that. Try again.");
    setResult(body);
    if (body.status === "CLOSED") onChanged();
  }

  async function undo(id: string) {
    if (!confirm("Undo this close? The period opens again, and any balance adjustment it recorded is deleted.")) return;
    const res = await fetch(`/api/close/entries/${id}`, { method: "DELETE" });
    if (!res.ok) return alert((await res.json().catch(() => null))?.error ?? "Couldn't undo it.");
    setResult(null);
    onChanged();
  }

  const offWord = (diff: number) => gapWords(diff, money(Math.abs(diff), a.currency), card);

  return (
    <article className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">
            {a.name}
            {a.last4 && <span className="ml-1 text-gray-400">••{a.last4}</span>}
          </h2>
          <p className="text-xs text-gray-500">
            {card ? "Credit card" : "Bank account"}
            {a.dueLabel && a.status !== "UNAVAILABLE" && ` · latest period: ${a.dueLabel}`}
          </p>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
      </header>

      <div className="space-y-2 border-t px-4 py-3 text-sm">
        {a.status === "UNAVAILABLE" && <p className="text-gray-600">{a.reason}</p>}
        {a.status === "NOT_DUE" && <p className="text-gray-600">This account&apos;s records start after its latest period ended. Close it at the end of this month.</p>}
        {a.latest && (
          <p className="text-gray-600">
            Last closed through <b>{day(a.latest.periodEnd)}</b> by {a.latest.closedByName} on {when(a.latest.closedAt)}
            {a.latest.adjustment !== 0 && <> with a {money(a.latest.adjustment, a.currency)} adjustment</>}.
          </p>
        )}
        {a.status === "CHANGED" && a.latest && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-expense-600">
            ⚠ Since that close, an entry on or before {day(a.latest.periodEnd)} was added, changed or deleted: the app now shows {offWord(a.latest.offNow)} for that date. Find
            the entry, or undo the close and close again.
          </p>
        )}

        {a.status !== "UNAVAILABLE" && (
          <button onClick={() => setOpen(!open)} className="text-brand-700 underline">
            {open ? "Hide" : a.status === "CLOSED" || a.status === "NOT_DUE" ? "Close a later date" : "Close this period"}
          </button>
        )}

        {open && a.status !== "UNAVAILABLE" && (
          <div className="space-y-3 rounded-lg bg-paper p-3">
            <p className="text-xs text-gray-600">
              {card
                ? "Enter what the card's app or statement says was owed on the closing date (the statement balance for a statement date)."
                : "Enter the bank's balance on the closing date (the ending balance on the statement for a month end)."}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-medium text-gray-600">
                {card ? "Card says owed" : "Bank shows"}
                <input
                  inputMode="decimal"
                  value={figure}
                  onChange={(e) => (setFigure(e.target.value), setResult(null))}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="0.00"
                  className="mt-1 block w-32 rounded border bg-white px-2 py-1.5 text-base font-normal tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-gray-600">
                Closing through
                <input
                  type="date"
                  value={date}
                  min={a.earliestDate ?? undefined}
                  max={getTodayLocal()}
                  onChange={(e) => (setDate(e.target.value), setResult(null))}
                  className="mt-1 block rounded border bg-white px-2 py-1.5 text-base font-normal"
                />
              </label>
              <button onClick={() => submit()} disabled={busy} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {busy ? "Checking…" : "Check and close"}
              </button>
            </div>
            {err && <p className="text-xs text-expense-600">{err}</p>}

            {result?.status === "CLOSED" && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-income-600">
                ✓ Closed through {day(result.asOfDate)}
                {result.adjustment !== 0 ? ` with a ${money(result.adjustment, a.currency)} balance adjustment recorded.` : `: the app and the ${card ? "card" : "bank"} both say ${money(result.figure, a.currency)}.`}
              </p>
            )}

            {result?.status === "OFF" && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
                <p className="font-medium text-expense-600">
                  Off by {money(Math.abs(result.diff), a.currency)}: the app says {money(result.app, a.currency)}
                  {card ? " owed" : ""}, the {card ? "card" : "bank"} {money(result.figure, a.currency)}.
                </p>
                <p className="mt-0.5 text-xs text-gray-600">The app shows {offWord(result.diff)}. Likely reasons, most telling first:</p>
                <HintList hints={result.hints} currency={a.currency} card={card} />
                <div className="mt-3 border-t border-red-200 pt-2.5">
                  <p className="text-xs text-gray-700">
                    Fix it on <Link href="/transactions" className="underline">Transactions</Link> and check again, or accept the difference:
                    {result.within ? ` it's within your ${money(result.toleranceUsd, "USD", 0)} tolerance.` : ` it's more than your ${money(result.toleranceUsd, "USD", 0)} tolerance, so say why.`}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={result.within ? "Note (optional)" : "Why it's being accepted (required)"}
                      className="min-w-0 flex-1 rounded border bg-white px-2 py-1.5 text-sm"
                      maxLength={500}
                    />
                    <button
                      onClick={() => submit(true)}
                      disabled={busy || (!result.within && !note.trim())}
                      className="rounded-md border border-brand-600 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                    >
                      Accept {money(Math.abs(result.diff), a.currency)} and close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {a.history.length > 0 && (
          <button onClick={() => setShowHistory(!showHistory)} className="block text-xs text-gray-500 underline">
            {showHistory ? "Hide history" : `History (${a.history.length})`}
          </button>
        )}
        {showHistory && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-1.5 pr-2">Period</th>
                  <th className="py-1.5 pr-2 text-right">{card ? "Card" : "Bank"}</th>
                  <th className="py-1.5 pr-2 text-right">App</th>
                  <th className="py-1.5 pr-2 text-right">Adjusted</th>
                  <th className="py-1.5 pr-2">Closed</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {a.history.map((h, i) => (
                  <tr key={h.id} className="border-b last:border-0 align-top">
                    <td className="py-1.5 pr-2">
                      {h.label}
                      {h.note && <span className="block text-gray-400">{h.note}</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{money(h.statementFigure, a.currency)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{money(h.appFigure, a.currency)}</td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums ${h.adjustment !== 0 ? "font-medium" : "text-gray-400"}`}>{h.adjustment !== 0 ? money(h.adjustment, a.currency) : "—"}</td>
                    <td className="py-1.5 pr-2 text-gray-500">
                      {h.closedByName}, {when(h.closedAt)}
                    </td>
                    <td className="py-1.5 text-right">
                      {i === 0 && (
                        <button onClick={() => undo(h.id)} className="text-expense-600 hover:underline">
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </article>
  );
}

function HintList({ hints, currency, card }: { hints: Hint[]; currency: string; card: boolean }) {
  const day = (d: string) => formatDate(d, { month: "short", day: "numeric", year: "numeric" });
  return (
    <ol className="mt-2 space-y-2 text-xs text-gray-700">
      {hints.map((h, k) => (
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
  );
}
