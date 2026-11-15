"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/money";

// Net worth at a glance, each figure linking to its page.
type NetWorth = { netWorth: number; investments: number; cash: number; foreignCash?: number; liabilities: number };

export default function WealthLine() {
  const [w, setW] = useState<NetWorth | null>(null);
  useEffect(() => {
    fetch("/api/net-worth")
      .then((r) => (r.ok ? r.json() : null))
      .then(setW)
      .catch(() => setW(null));
  }, []);
  if (!w) return null;
  const cells: { label: string; value: number; href: string; note?: string }[] = [
    // Bank money in other currencies is in here too, converted roughly.
    { label: "Net worth", value: w.netWorth, href: "/net-worth", note: w.foreignCash && Math.abs(w.foreignCash) >= 1 ? `incl. about ${money(w.foreignCash, "USD", 0)} held outside dollars` : undefined },
    { label: "Investments", value: w.investments, href: "/investments" },
    // Everything owed on the cards right now (not just the statements due)
    // plus what's left on loans -- so it's more than the card bills above.
    { label: "Debts", value: -w.liabilities, href: "/debts", note: "owed on cards now + loans" },
  ];
  return (
    <section aria-label="Wealth" className="grid grid-cols-3 divide-x rounded-xl border bg-white shadow-sm">
      {cells.map((c) => (
        <Link key={c.label} href={c.href} className="px-3 py-3 active:bg-gray-50">
          <span className="block text-xs text-gray-500">{c.label} ›</span>
          <span className={`font-display block text-lg tabular-nums ${c.value < 0 ? "text-expense-600" : ""}`}>{money(c.value, "USD", 0)}</span>
          {c.note && <span className="block text-[11px] text-gray-400">{c.note}</span>}
        </Link>
      ))}
    </section>
  );
}
