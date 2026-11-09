"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/money";

// Net worth at a glance, each figure linking to its page.
type NetWorth = { netWorth: number; investments: number; cash: number; liabilities: number };

export default function WealthLine() {
  const [w, setW] = useState<NetWorth | null>(null);
  useEffect(() => {
    fetch("/api/net-worth")
      .then((r) => (r.ok ? r.json() : null))
      .then(setW)
      .catch(() => setW(null));
  }, []);
  if (!w) return null;
  const cells = [
    { label: "Net worth", value: w.netWorth, href: "/net-worth" },
    { label: "Investments", value: w.investments, href: "/investments" },
    { label: "Debts", value: -w.liabilities, href: "/debts" },
  ];
  return (
    <section aria-label="Wealth" className="grid grid-cols-3 divide-x rounded-xl border bg-white shadow-sm">
      {cells.map((c) => (
        <Link key={c.label} href={c.href} className="px-3 py-3 active:bg-gray-50">
          <span className="block text-xs text-gray-500">{c.label} ›</span>
          <span className={`font-display block text-lg tabular-nums ${c.value < 0 ? "text-expense-600" : ""}`}>{money(c.value, "USD", 0)}</span>
        </Link>
      ))}
    </section>
  );
}
