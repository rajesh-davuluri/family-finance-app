"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "@/lib/money";
import { NEW_PREFIX, allocate, categoryForKind, classifyItem, itemKey, type ReceiptItem } from "@/lib/receiptItems";

// The items read off a store receipt, each with a category (remembered from
// earlier bills, else guessed from the item's name), and the bill's total
// split across those categories. The person can move any item; the split
// is saved as linked transactions by /api/transactions/split.

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE" };
export type SplitValue = {
  enabled: boolean;
  parts: { categoryId: string; amount: number }[];
  items: { key: string; categoryId: string }[];
};

export default function SplitEditor({
  items,
  categories,
  rules,
  total,
  currency,
  onChange,
}: {
  items: ReceiptItem[];
  categories: Category[];
  rules: Record<string, string>;
  total: number;
  currency: string;
  onChange: (v: SplitValue) => void;
}) {
  const expense = useMemo(() => categories.filter((c) => c.direction === "EXPENSE"), [categories]);
  const [assigned, setAssigned] = useState<string[]>(() =>
    items.map((i) => {
      const remembered = rules[itemKey(i.name)];
      if (remembered && expense.some((c) => c.id === remembered)) return remembered;
      return categoryForKind(classifyItem(i.name), expense) ?? expense[0]?.id ?? "";
    }),
  );
  const [showItems, setShowItems] = useState(false);

  // Categories offered: the household's, plus any new one a guess proposed.
  const proposedNew = Array.from(new Set(assigned.filter((a) => a.startsWith(NEW_PREFIX))));
  const nameOf = (id: string) => (id.startsWith(NEW_PREFIX) ? `${id.slice(NEW_PREFIX.length)} (new)` : expense.find((c) => c.id === id)?.name ?? "—");

  const byCategory = useMemo(() => {
    const m = new Map<string, { amount: number; count: number }>();
    items.forEach((it, i) => {
      const k = assigned[i];
      const e = m.get(k) ?? { amount: 0, count: 0 };
      e.amount += it.amount;
      e.count += 1;
      m.set(k, e);
    });
    return m;
  }, [items, assigned]);
  const itemsSum = items.reduce((t, i) => t + i.amount, 0);
  const shares = useMemo(
    () => (total > 0 ? allocate([...byCategory.entries()].map(([key, v]) => ({ key, amount: v.amount })), total) : []),
    [byCategory, total],
  );
  const [enabled, setEnabled] = useState(byCategory.size > 1);

  useEffect(() => {
    onChange({
      enabled: enabled && shares.length > 0,
      parts: shares.map((s) => ({ categoryId: s.key, amount: s.amount })),
      items: items.map((it, i) => ({ key: itemKey(it.name), categoryId: assigned[i] })).filter((x) => x.key && x.categoryId),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, shares, assigned]);

  const gap = Math.round((total - itemsSum) * 100) / 100;
  const missingALot = total > 0 && itemsSum < total * 0.75;

  return (
    <div className="rounded-md border border-brand-300 bg-brand-50/50 p-3 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span className="font-medium">
          🧾 {items.length} items · split into {byCategory.size} categor{byCategory.size === 1 ? "y" : "ies"}
        </span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5" aria-label="Split this bill by category" />
      </label>

      {enabled && (
        <>
          <ul className="mt-2 divide-y rounded-md border bg-white">
            {shares.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  {nameOf(s.key)}
                  <span className="ml-1 text-xs text-gray-400">
                    {byCategory.get(s.key)?.count} item{byCategory.get(s.key)?.count === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="tabular-nums font-medium">{money(s.amount, currency)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-gray-500">
            {Math.abs(gap) >= 0.01
              ? `Items come to ${money(itemsSum, currency)}; the ${money(Math.abs(gap), currency)} ${gap > 0 ? "tax and anything unread" : "in savings"} is spread across the categories.`
              : "Adds up to the bill total."}
            {missingALot && <span className="text-amber-700"> Some items may not have been read — check the list.</span>}
          </p>
          <button type="button" onClick={() => setShowItems((v) => !v)} className="mt-1 text-brand-700 underline">
            {showItems ? "Hide items" : "Check or move items"}
          </button>
          {showItems && (
            <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-md border bg-white">
              {items.map((it, i) => (
                <li key={i} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{it.name}</span>
                    <span className="block text-xs tabular-nums text-gray-500">{money(it.amount, currency)}</span>
                  </span>
                  <select
                    value={assigned[i]}
                    onChange={(e) => setAssigned((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                    className="w-36 shrink-0 rounded border px-1.5 py-1 text-xs"
                    aria-label={`Category for ${it.name}`}
                  >
                    {expense.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    {proposedNew.map((id) => (
                      <option key={id} value={id}>
                        {nameOf(id)}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-gray-500">Saved as {shares.length} linked parts of one charge. Items you move are remembered for the next bill.</p>
        </>
      )}
    </div>
  );
}
