"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/formatDate";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import type { EditableTransaction } from "@/components/AddTransactionModal";

// What the dashboard shows when a number is tapped: the categories behind a
// total, then the transactions behind a category -- or a plain list (bills
// due before payday). A sheet from the bottom on a phone, a side panel on
// wider screens. Transactions open for editing.

export type Slice = { id: string; name: string; total: number };
export type Drill =
  | { kind: "categories"; title: string; subtitle?: string; from: string; to: string; items: Slice[] }
  | { kind: "transactions"; title: string; subtitle?: string; from: string; to: string; categoryId?: string; instrumentId?: string }
  | { kind: "list"; title: string; subtitle?: string; rows: { key: string; label: string; sub?: string; amount: number; currency: string }[] };

type Txn = {
  id: string;
  amount: string;
  currency: string;
  date: string;
  notes: string | null;
  category: { id: string; name: string; direction: string };
  instrument: { id: string; name: string };
  attachment?: { id: string } | null;
  splitGroupId?: string | null;
};

export default function DrillSheet({ drill, onClose, onEdit }: { drill: Drill | null; onClose: () => void; onEdit: (t: EditableTransaction) => void }) {
  // A stack, so a category opened from a list can go back to the list.
  const [stack, setStack] = useState<Drill[]>([]);
  useEffect(() => setStack(drill ? [drill] : []), [drill]);
  const top = stack[stack.length - 1] ?? null;

  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [top, onClose]);

  if (!top) return null;
  const range = "from" in top ? `${formatDate(top.from, { month: "short", day: "numeric" })} – ${formatDate(top.to, { month: "short", day: "numeric", year: "numeric" })}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-stretch sm:justify-end" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={top.title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-h-none sm:w-[28rem] sm:rounded-none"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-200 sm:hidden" aria-hidden />
        <header className="flex items-start gap-2 border-b px-4 py-3">
          {stack.length > 1 && (
            <button onClick={() => setStack((s) => s.slice(0, -1))} className="-ml-2 flex h-9 w-9 items-center justify-center text-xl text-gray-500" aria-label="Back">
              ‹
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-lg">{top.title}</h2>
            <p className="text-xs text-gray-500">{[top.subtitle, range].filter(Boolean).join(" · ")}</p>
          </div>
          <button onClick={onClose} className="-mr-2 flex h-9 w-9 items-center justify-center text-gray-400" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {top.kind === "categories" && (
            <CategoryList
              drill={top}
              onOpen={(s) =>
                setStack((st) => [...st, { kind: "transactions", title: s.name, subtitle: top.title, from: top.from, to: top.to, categoryId: s.id }])
              }
            />
          )}
          {top.kind === "transactions" && <TransactionList drill={top} onEdit={onEdit} />}
          {top.kind === "list" && (
            <ul className="divide-y">
              {top.rows.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{r.label}</span>
                    {r.sub && <span className="block text-xs text-gray-500">{r.sub}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums font-medium">{money(r.amount, r.currency)}</span>
                </li>
              ))}
              {top.rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">Nothing here.</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryList({ drill, onOpen }: { drill: Extract<Drill, { kind: "categories" }>; onOpen: (s: Slice) => void }) {
  const total = drill.items.reduce((t, s) => t + s.total, 0);
  const max = Math.max(...drill.items.map((s) => s.total), 1);
  return (
    <>
      <p className="px-4 pt-3 text-sm text-gray-600">
        Total <span className="font-semibold tabular-nums text-ink-900">{money(total, "USD")}</span>
      </p>
      <ul className="py-1">
        {drill.items.map((s) => (
          <li key={s.id}>
            <button onClick={() => onOpen(s)} className="block w-full px-4 py-2.5 text-left active:bg-gray-50">
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 tabular-nums font-medium">
                  {money(s.total, "USD")} <span className="text-xs font-normal text-gray-400">{total ? Math.round((s.total / total) * 100) : 0}%</span>
                </span>
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-gray-100">
                <span className="block h-full rounded-full bg-brand-400" style={{ width: `${(s.total / max) * 100}%` }} />
              </span>
            </button>
          </li>
        ))}
        {drill.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">Nothing in this period.</li>}
      </ul>
    </>
  );
}

function TransactionList({ drill, onEdit }: { drill: Extract<Drill, { kind: "transactions" }>; onEdit: (t: EditableTransaction) => void }) {
  const [rows, setRows] = useState<Txn[] | null>(null);
  useEffect(() => {
    const load = () => {
      const q = new URLSearchParams({ from: drill.from, to: drill.to, limit: "500" });
      if (drill.categoryId) q.set("categoryId", drill.categoryId);
      if (drill.instrumentId) q.set("instrumentId", drill.instrumentId);
      fetch(`/api/transactions?${q}`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setRows)
        .catch(() => setRows([]));
    };
    setRows(null);
    load();
    window.addEventListener(TRANSACTIONS_CHANGED, load);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, load);
  }, [drill]);

  if (!rows) return <p className="px-4 py-6 text-sm text-gray-400">Loading…</p>;
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-gray-400">No transactions.</p>;
  const byCurrency = new Map<string, number>();
  for (const t of rows) byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0) + Number(t.amount));

  return (
    <>
      <p className="px-4 pt-3 text-sm text-gray-600">
        {rows.length} transaction{rows.length === 1 ? "" : "s"} ·{" "}
        {[...byCurrency.entries()].map(([c, v]) => (
          <span key={c} className="mr-2 font-semibold tabular-nums text-ink-900">
            {money(v, c)}
          </span>
        ))}
      </p>
      <ul className="py-1">
        {rows.map((t, i) => {
          const day = t.date.slice(0, 10);
          const newDay = i === 0 || rows[i - 1].date.slice(0, 10) !== day;
          return (
            <li key={t.id}>
              {newDay && <p className="bg-gray-50 px-4 py-1 text-xs font-medium text-gray-500">{formatDate(day, { weekday: "short", month: "short", day: "numeric" })}</p>}
              <button
                onClick={() =>
                  onEdit({
                    id: t.id,
                    amount: t.amount,
                    currency: t.currency,
                    date: t.date,
                    notes: t.notes,
                    categoryId: t.category.id,
                    instrumentId: t.instrument.id,
                    hasPhoto: !!t.attachment,
                  })
                }
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-gray-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {t.attachment && <span aria-hidden>📎 </span>}
                    {t.notes || t.category.name}
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    {t.splitGroupId && <span className="mr-1 rounded bg-brand-50 px-1 text-[10px] font-medium uppercase text-brand-700">split</span>}
                    {t.notes ? `${t.category.name} · ` : ""}
                    {t.instrument.name}
                  </span>
                </span>
                <span className={`shrink-0 text-sm font-medium tabular-nums ${t.category.direction === "INCOME" ? "text-income-600" : ""}`}>
                  {t.category.direction === "INCOME" ? "+" : ""}
                  {money(Number(t.amount), t.currency)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
