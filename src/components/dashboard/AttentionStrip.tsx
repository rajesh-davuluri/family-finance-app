"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TRANSACTIONS_CHANGED } from "@/lib/events";
import type { AttentionItem } from "@/lib/attention";

// The few things worth acting on now (src/lib/attention.ts), or "All clear".
export default function AttentionStrip() {
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const load = useCallback(() => {
    fetch("/api/dashboard/attention", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => setItems(j.items ?? []))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(TRANSACTIONS_CHANGED, load);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, load);
  }, [load]);

  if (!items) return null;
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-income-500/30 bg-green-50 px-4 py-2.5 text-sm text-income-600">
        <span aria-hidden>✓</span> All clear — nothing needs your attention.
      </p>
    );
  }
  return (
    <section aria-label="Needs attention" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
      <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
        Needs attention · {items.length}
      </p>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.key}>
            <Link href={i.href} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm text-ink-900 active:bg-amber-100">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${i.level === "high" ? "bg-expense-500" : "bg-amber-500"}`} />
              <span className="min-w-0 flex-1">{i.text}</span>
              <span aria-hidden className="text-amber-700">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
