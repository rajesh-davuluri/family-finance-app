"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/formatDate";
import { money } from "@/lib/money";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import type { CardSnapshot } from "@/lib/cards";
import { CashEvent, cashPlan } from "@/lib/cashPlan";
import MarkCardPaid from "@/components/MarkCardPaid";
import type { Drill } from "@/components/dashboard/DrillSheet";

// The dashboard's first glance: cash in the bank, and each credit card bill
// with its due date. Card numbers come from /api/cards (the Credit cards
// page); bank balances from /api/instruments (opening balance + activity).

type Card = { id: string; name: string; last4: string | null; currency: string; snapshot: CardSnapshot };
type Instrument = { id: string; name: string; type: string; currency: string; archived: boolean; currentBalance: number | null; lastCheck?: { matched: boolean; daysSince: number; asOfDate: string } | null };

const short = (d: string) => formatDate(d, { month: "short", day: "numeric" });

// What /api/planner returns: the payday planner's inputs (src/lib/cashPlan.ts).
type Planner = {
  today: string;
  cashUsd: number;
  accounts: { name: string; usd: number | null; counted: boolean; note?: string }[];
  events: CashEvent[];
  nextPayday: string | null;
  everydayDailyUsd: number;
  windowDays: number;
  cushionUsd: number;
  setAsideUsd: number;
  plannedDue: { date: string; usd: number }[];
};

function dueWhen(days: number) {
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `in ${days} days`;
}
// The same, for a narrow tile.
function dueShort(days: number) {
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days}d`;
}

// Overdue first, then soonest due; paid and not-yet-set-up cards last.
function rank(c: Card) {
  const s = c.snapshot;
  if (!s.hasCycle) return 9;
  return s.status === "OVERDUE" ? 0 : s.status === "DUE" ? 1 : s.status === "PAID" ? 2 : 3;
}

export default function MoneyTiles({ onDrill }: { onDrill?: (d: Drill) => void }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [planner, setPlanner] = useState<Planner | null>(null);
  const [banks, setBanks] = useState<Instrument[] | null>(null);
  const [paying, setPaying] = useState<Card | null>(null);

  const load = useCallback(() => {
    fetch("/api/cards", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCards(j?.cards ?? []))
      .catch(() => setCards([]));
    fetch("/api/instruments", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Instrument[]) => setBanks(list.filter((i) => i.type === "BANK_ACCOUNT" && !i.archived)))
      .catch(() => setBanks([]));
    fetch("/api/planner", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setPlanner)
      .catch(() => setPlanner(null));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(TRANSACTIONS_CHANGED, load);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, load);
  }, [load]);

  if (!cards || !banks) {
    return <div className="h-28 animate-pulse rounded-xl bg-white/60" aria-hidden />;
  }

  const billCards = [...cards].filter((c) => c.snapshot.hasCycle).sort((a, b) => rank(a) - rank(b) || (a.snapshot.daysToDue ?? 0) - (b.snapshot.daysToDue ?? 0));
  const notSetUp = cards.length - billCards.length;

  // Bank money by currency, and what's left once the card bills are paid.
  const inBank = new Map<string, number>();
  for (const b of banks) if (b.currentBalance != null) inBank.set(b.currency, (inBank.get(b.currency) ?? 0) + Number(b.currentBalance));
  const missingBalance = banks.filter((b) => b.currentBalance == null);

  // Safe to spend until payday: the payday planner's own figure, so the
  // dashboard and the Planner page always agree. Bank cash (not the emergency
  // fund) less every bill, card payment and loan instalment due before the
  // next paycheck, and less the money set aside for the year ahead.
  const safe = (() => {
    if (!planner || !planner.accounts.some((a) => a.counted)) return null;
    const p = cashPlan({ ...planner, days: planner.windowDays });
    const rows: { key: string; label: string; sub?: string; amount: number; currency: string }[] = planner.accounts
      .filter((a) => a.counted && a.usd != null)
      .map((a) => ({ key: `bank:${a.name}`, label: a.name, sub: "in the bank now", amount: a.usd!, currency: "USD" }));
    for (const e of p.dueBeforePayday) rows.push({ key: e.key, label: e.label, sub: `due ${short(e.date)}${e.sub ? ` · ${e.sub}` : ""}`, amount: -e.paid, currency: "USD" });
    if (p.held > 0) rows.push({ key: "held", label: "Set aside for the year ahead", sub: "big costs later in the year", amount: -p.held, currency: "USD" });
    const left = planner.accounts.filter((a) => !a.counted && a.note && a.note !== "no balance set").map((a) => `${a.name} (${a.note})`);
    return { amount: p.safe, rows, payday: p.payday, notCounted: left };
  })();
  const payday = safe?.payday ?? null;

  // Enough columns that every bill fits in two rows beside the bank money
  // (three once there are more than a dozen); the tiles tighten up to match.
  const n = billCards.length;
  const cols = n <= 4 ? 2 : n <= 12 ? Math.ceil(n / 2) : Math.ceil(n / 3);
  const dense = cols >= 4;
  const view = (c: Card) => {
    const s = c.snapshot;
    const st = s.statement!;
    const paid = s.status === "PAID" || s.status === "NOTHING_DUE";
    const urgent = s.status === "OVERDUE" || (s.status === "DUE" && (s.daysToDue ?? 99) <= 5);
    const on = `${st.dueDateApprox ? "~" : ""}${short(st.dueDate)}`;
    const estimated = st.basis === "ESTIMATED";
    return {
      st,
      paid,
      estimated,
      // Owed on the card right now, and the part of it not on a statement
      // yet (charges since it closed, less refunds), so billed + unbilled
      // always add up to the total.
      total: s.outstanding ?? s.leftOnStatement,
      unbilled: Math.round(((s.outstanding ?? s.leftOnStatement) - s.leftOnStatement) * 100) / 100,
      due: `Due ${on} · ${dueWhen(s.daysToDue ?? 0)}`,
      dueShort: `${on} · ${dueShort(s.daysToDue ?? 0)}${estimated ? " · est." : ""}`,
      tone: paid ? "text-income-600" : s.status === "OVERDUE" ? "font-medium text-expense-600" : urgent ? "font-medium text-amber-700" : "text-gray-500",
      border: s.status === "OVERDUE" ? "border-expense-500" : urgent ? "border-amber-400" : "",
    };
  };

  return (
    <section aria-label="Bank money and card bills" className="grid gap-3 lg:grid-cols-3">
      {/* Money in the bank */}
      <div className="rounded-xl bg-ink-900 p-4 text-white shadow-sm">
        <Link href="/instruments" className="text-xs uppercase tracking-wide text-ink-300 underline-offset-2 hover:underline">
          Available in banks
        </Link>
        {inBank.size === 0 ? (
          <p className="mt-2 text-sm text-ink-300">Set a balance on your bank accounts to see it here.</p>
        ) : (
          [...inBank.entries()].map(([cur, total]) => (
            <p key={cur} className="font-display mt-1 text-3xl tabular-nums">
              {money(total, cur)}
            </p>
          ))
        )}
        <ul className="mt-3 space-y-1 text-sm">
          {banks.map((b) => (
            <li key={b.id} className="flex justify-between gap-3">
              <span className="truncate text-ink-300">
                {b.name}
                {/* Checked against the bank's own balance (Accounts & cards). */}
                {b.lastCheck && !b.lastCheck.matched && (
                  <span className="ml-1 text-red-300" title="Doesn't match the bank's balance">
                    ⚠
                  </span>
                )}
                {b.lastCheck?.matched && b.lastCheck.daysSince < 45 && (
                  <span className="ml-1 text-brand-300" title={`Matches the bank as of ${short(b.lastCheck.asOfDate)}`}>
                    ✓
                  </span>
                )}
              </span>
              <span className="tabular-nums">{b.currentBalance == null ? <span className="text-ink-300">set balance</span> : money(Number(b.currentBalance), b.currency)}</span>
            </li>
          ))}
        </ul>
        {safe && (
          <button
            onClick={() =>
              onDrill?.({
                kind: "list",
                title: payday ? `Safe to spend until ${short(payday)}` : `Safe to spend · next ${planner?.windowDays ?? 30} days`,
                subtitle: `Bank cash less what's due ${payday ? "before payday" : "in that time"}${safe.notCounted.length ? `. Not counted: ${safe.notCounted.join(", ")}` : ""}`,
                rows: safe.rows,
              })
            }
            className="mt-3 flex w-full items-center justify-between gap-3 border-t border-white/15 pt-2 text-left text-sm"
          >
            <span className="text-ink-300">{payday ? `Safe to spend until payday (${short(payday)})` : "Safe to spend"} ›</span>
            <span className={`font-display text-lg tabular-nums ${safe.amount < 0 ? "text-red-300" : "text-brand-300"}`}>{money(safe.amount, "USD")}</span>
          </button>
        )}
        {missingBalance.length > 0 && inBank.size > 0 && (
          <p className="mt-2 text-xs text-ink-300">Not counted: {missingBalance.map((b) => b.name).join(", ")} (no balance set)</p>
        )}
      </div>

      {/* Every card bill at once, beside the bank money. */}
      <div className="flex flex-col lg:col-span-2">
        {billCards.length > 0 && <p className="mb-1.5 px-1 text-xs uppercase tracking-wide text-gray-500">Card bills · billed, unbilled and total owed</p>}
        {/* Phone: one compact card, a row per bill. */}
        {billCards.length > 0 && (
          <ul className="divide-y rounded-xl border bg-white px-3 shadow-sm sm:hidden">
            {billCards.map((c) => {
              const v = view(c);
              return (
                <li key={c.id} className="relative py-2">
                  <div className="flex items-center gap-3">
                  <Link href="/cards" className="absolute inset-0 active:bg-gray-50/60" aria-label={`${c.name} on Credit cards`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {c.name}
                      {c.last4 && <span className="text-gray-400"> ••{c.last4}</span>}
                    </p>
                    <p className={`truncate text-xs ${v.tone}`}>{v.paid ? `Paid ✓ · next closes ${short(c.snapshot.nextClose!)}` : v.due}</p>
                  </div>
                  <p className={`shrink-0 text-right tabular-nums ${v.paid ? "text-gray-400" : "font-medium"}`}>
                    <span className="block text-[10px] font-normal uppercase tracking-wide text-gray-400">{v.paid ? "Bill was" : "Billed"}</span>
                    {money(v.paid ? v.st.balance : c.snapshot.leftOnStatement, c.currency)}
                    {v.estimated && <span className="block text-[10px] font-normal text-gray-400">estimated</span>}
                  </p>
                  {!v.paid && (
                    <button onClick={() => setPaying(c)} className="relative shrink-0 rounded-md border border-brand-400 px-2 py-1.5 text-xs font-medium text-brand-700 active:bg-brand-50">
                      Mark paid
                    </button>
                  )}
                  </div>
                  <p className="mt-0.5 flex justify-between gap-3 text-xs tabular-nums text-gray-500">
                    <span>Unbilled {money(v.unbilled, c.currency)}</span>
                    <span>
                      Total owed <span className="font-medium text-ink-900">{money(v.total, c.currency)}</span>
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {/* Wider screens: a tile per bill, sized so they all fit beside the bank money. */}
        <div className="hidden flex-1 grid-cols-4 gap-2 sm:grid lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))]" style={{ "--cols": cols } as React.CSSProperties}>
          {billCards.map((c) => {
            const s = c.snapshot;
            const v = view(c);
            return (
              <div key={c.id} className={`relative flex min-w-0 flex-col rounded-xl border bg-white shadow-sm ${dense ? "p-2.5" : "p-3"} ${v.border}`}>
                {/* The whole tile opens Credit cards; the button sits above the link. */}
                <Link href="/cards" className="absolute inset-0 rounded-xl active:bg-gray-50/60" aria-label={`${c.name} on Credit cards`} />
                <p className="truncate text-xs text-gray-500" title={c.name}>
                  {c.name}
                  {c.last4 && <span className="text-gray-400"> ••{c.last4}</span>}
                </p>
                {v.paid ? (
                  <>
                    <p className={`font-display mt-0.5 text-income-600 ${dense ? "text-lg" : "text-xl"}`}>Paid ✓</p>
                    <p className="truncate text-xs text-gray-500" title={`${money(v.st.balance, c.currency)} bill · next closes ${short(s.nextClose!)}`}>
                      {dense ? `next closes ${short(s.nextClose!)}` : `${money(v.st.balance, c.currency)} bill · next closes ${short(s.nextClose!)}`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-[10px] uppercase leading-none tracking-wide text-gray-400">Billed</p>
                    <p className={`font-display truncate tabular-nums ${dense ? "text-lg" : "text-xl"}`} title="Billed: left to pay on the statement">
                      {money(s.leftOnStatement, c.currency)}
                    </p>
                    <p className={`truncate text-xs ${v.tone}`} title={v.due}>
                      {dense ? v.dueShort : v.due}
                    </p>
                    {!dense && s.minimumLeft != null && s.minimumLeft > 0.005 && <p className="text-xs text-gray-400">min {money(s.minimumLeft, c.currency)}</p>}
                  </>
                )}
                {v.estimated && !dense && <p className="mt-0.5 text-[11px] text-gray-400">estimated</p>}
                {/* Not on a statement yet, and everything owed on the card now. */}
                <dl className={`mt-1.5 space-y-0.5 border-t pt-1.5 tabular-nums ${dense ? "text-[11px]" : "text-xs"}`}>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">Unbilled</dt>
                    <dd className="truncate">{money(v.unbilled, c.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">Total</dt>
                    <dd className="truncate font-medium">{money(v.total, c.currency)}</dd>
                  </div>
                </dl>
                {!v.paid && (
                  <button
                    onClick={() => setPaying(c)}
                    className={`relative mt-2 self-start rounded-md border border-brand-400 font-medium text-brand-700 hover:bg-brand-50 active:bg-brand-50 ${dense ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}`}
                  >
                    Mark paid
                  </button>
                )}
              </div>
            );
          })}
          {cards.length > 0 && billCards.length === 0 && (
            <Link href="/cards" className="col-span-full self-start rounded-xl border border-dashed bg-white p-3 text-sm text-gray-600">
              Set each card&apos;s statement closing day on Credit cards to see bills and due dates here.
            </Link>
          )}
        </div>
        {cards.length > 0 && billCards.length === 0 && (
          <Link href="/cards" className="block rounded-xl border border-dashed bg-white p-3 text-sm text-gray-600 sm:hidden">
            Set each card&apos;s statement closing day on Credit cards to see bills and due dates here.
          </Link>
        )}
        {notSetUp > 0 && billCards.length > 0 && (
          <Link href="/cards" className="mt-2 block px-1 text-xs text-gray-500 underline">
            {notSetUp} more card{notSetUp === 1 ? "" : "s"} not set up yet
          </Link>
        )}
      </div>
      {paying && (
        <MarkCardPaid
          card={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            load();
          }}
        />
      )}
    </section>
  );
}
