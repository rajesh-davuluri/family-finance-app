"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/formatDate";
import { money } from "@/lib/money";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import type { CardSnapshot } from "@/lib/cards";
import MarkCardPaid from "@/components/MarkCardPaid";
import type { Drill } from "@/components/dashboard/DrillSheet";

// The dashboard's first glance: cash in the bank, and each credit card bill
// with its due date. Card numbers come from /api/cards (the Credit cards
// page); bank balances from /api/instruments (opening balance + activity).

type Card = { id: string; name: string; last4: string | null; currency: string; snapshot: CardSnapshot };
type Instrument = { id: string; name: string; type: string; currency: string; archived: boolean; currentBalance: number | null };

const short = (d: string) => formatDate(d, { month: "short", day: "numeric" });

type PayCycle =
  | { hasData: false }
  | {
      hasData: true;
      nextPaycheck: { date: string; daysUntil: number };
      upcomingBills: { id: string; categoryName: string; instrumentName: string; amount: string; currency: string; nextRunAt: string }[];
    };

function dueWhen(days: number) {
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `in ${days} days`;
}

// Overdue first, then soonest due; paid and not-yet-set-up cards last.
function rank(c: Card) {
  const s = c.snapshot;
  if (!s.hasCycle) return 9;
  return s.status === "OVERDUE" ? 0 : s.status === "DUE" ? 1 : s.status === "PAID" ? 2 : 3;
}

export default function MoneyTiles({ onDrill }: { onDrill?: (d: Drill) => void }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [cycle, setCycle] = useState<PayCycle | null>(null);
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
    fetch("/api/pay-cycle", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { hasData: false }))
      .then(setCycle)
      .catch(() => setCycle({ hasData: false }));
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

  // Safe to spend until payday (dollars): bank money, less the card
  // statements due before the next paycheck and the recurring bills paid
  // from a bank account before then. Bills due after payday come out of it.
  const payday = cycle?.hasData ? cycle.nextPaycheck.date.slice(0, 10) : null;
  const usdBanks = banks.filter((b) => b.currency === "USD" && b.currentBalance != null);
  const safe = (() => {
    if (!usdBanks.length) return null;
    const rows: { key: string; label: string; sub?: string; amount: number; currency: string }[] = usdBanks.map((b) => ({
      key: `bank:${b.id}`,
      label: b.name,
      sub: "in the bank now",
      amount: Number(b.currentBalance),
      currency: "USD",
    }));
    for (const c of billCards) {
      const s = c.snapshot;
      if (c.currency !== "USD" || s.leftOnStatement <= 0.005 || !s.statement) continue;
      if (payday && s.statement.dueDate > payday) continue;
      rows.push({ key: `card:${c.id}`, label: `${c.name} bill`, sub: `due ${short(s.statement.dueDate)}`, amount: -s.leftOnStatement, currency: "USD" });
    }
    if (cycle?.hasData) {
      const bankNames = new Set(banks.map((b) => b.name));
      for (const bill of cycle.upcomingBills) {
        if (bill.currency !== "USD" || !bankNames.has(bill.instrumentName)) continue;
        rows.push({ key: `bill:${bill.id}`, label: bill.categoryName, sub: `recurring · ${short(bill.nextRunAt.slice(0, 10))} · ${bill.instrumentName}`, amount: -Number(bill.amount), currency: "USD" });
      }
    }
    return { amount: Math.round(rows.reduce((t, r) => t + r.amount, 0) * 100) / 100, rows };
  })();

  return (
    <section aria-label="Bank money and card bills" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* Money in the bank */}
      <div className="col-span-2 rounded-xl bg-ink-900 p-4 text-white shadow-sm lg:row-span-2">
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
              <span className="truncate text-ink-300">{b.name}</span>
              <span className="tabular-nums">{b.currentBalance == null ? <span className="text-ink-300">set balance</span> : money(Number(b.currentBalance), b.currency)}</span>
            </li>
          ))}
        </ul>
        {safe && (
          <button
            onClick={() =>
              onDrill?.({
                kind: "list",
                title: payday ? `Safe to spend until ${short(payday)}` : "After card bills",
                subtitle: payday ? "Bank money less what's due before payday" : "Bank money less the card bills",
                rows: safe.rows,
              })
            }
            className="mt-3 flex w-full items-center justify-between gap-3 border-t border-white/15 pt-2 text-left text-sm"
          >
            <span className="text-ink-300">{payday ? `Safe to spend until payday (${short(payday)})` : "After card bills"} ›</span>
            <span className={`font-display text-lg tabular-nums ${safe.amount < 0 ? "text-red-300" : "text-brand-300"}`}>{money(safe.amount, "USD")}</span>
          </button>
        )}
        {missingBalance.length > 0 && inBank.size > 0 && (
          <p className="mt-2 text-xs text-ink-300">Not counted: {missingBalance.map((b) => b.name).join(", ")} (no balance set)</p>
        )}
      </div>

      {/* One tile per card bill */}
      {billCards.map((c) => {
        const s = c.snapshot;
        const st = s.statement!;
        const paid = s.status === "PAID" || s.status === "NOTHING_DUE";
        const urgent = s.status === "OVERDUE" || (s.status === "DUE" && (s.daysToDue ?? 99) <= 5);
        return (
          <div
            key={c.id}
            className={`relative flex flex-col rounded-xl border bg-white p-3 shadow-sm ${s.status === "OVERDUE" ? "border-expense-500" : urgent ? "border-amber-400" : ""}`}
          >
            {/* The whole tile opens Credit cards; the button sits above the link. */}
            <Link href="/cards" className="absolute inset-0 rounded-xl active:bg-gray-50/60" aria-label={`${c.name} on Credit cards`} />
            <p className="truncate text-xs text-gray-500">
              {c.name}
              {c.last4 && <span className="text-gray-400"> ••{c.last4}</span>}
            </p>
            {paid ? (
              <>
                <p className="font-display mt-1 text-xl text-income-600">Paid ✓</p>
                <p className="text-xs text-gray-500">
                  {money(st.balance, c.currency)} bill · next closes {short(s.nextClose!)}
                </p>
              </>
            ) : (
              <>
                <p className="font-display mt-1 text-xl tabular-nums">{money(s.leftOnStatement, c.currency)}</p>
                <p className={`text-xs ${s.status === "OVERDUE" ? "font-medium text-expense-600" : urgent ? "font-medium text-amber-700" : "text-gray-500"}`}>
                  Due {st.dueDateApprox ? "~" : ""}
                  {short(st.dueDate)} · {dueWhen(s.daysToDue ?? 0)}
                </p>
                {s.minimumLeft != null && s.minimumLeft > 0.005 && (
                  <p className="text-xs text-gray-400">min {money(s.minimumLeft, c.currency)}</p>
                )}
              </>
            )}
            {st.basis === "ESTIMATED" && <p className="mt-0.5 text-[11px] text-gray-400">estimated</p>}
            {!paid && (
              <button
                onClick={() => setPaying(c)}
                className="relative mt-2 self-start rounded-md border border-brand-400 px-2.5 py-1 text-xs font-medium text-brand-700 active:bg-brand-50"
              >
                Mark paid
              </button>
            )}
          </div>
        );
      })}

      {cards.length > 0 && billCards.length === 0 && (
        <Link href="/cards" className="col-span-2 rounded-xl border border-dashed bg-white p-3 text-sm text-gray-600">
          Set each card&apos;s statement closing day on Credit cards to see bills and due dates here.
        </Link>
      )}
      {notSetUp > 0 && billCards.length > 0 && (
        <Link href="/cards" className="col-span-2 self-center px-1 text-xs text-gray-500 underline lg:col-span-2">
          {notSetUp} more card{notSetUp === 1 ? "" : "s"} not set up yet
        </Link>
      )}
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
