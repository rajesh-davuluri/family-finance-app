"use client";

// Overview tab: the portfolio at a glance -- value, the few numbers that
// matter, how it's split, a health check, the biggest holdings and what
// stands out.

import { useState } from "react";
import { type Health, type HealthStatus, type HoldingRow, type Insight, type Slice, analyze } from "@/lib/investments";
import { pctText, tone } from "./shared";

type Analysis = ReturnType<typeof analyze>;
export type Money = (usd: number) => string;

// Categorical slots, fixed order (validated: adjacent CVD and normal-vision
// separation pass on white). Aqua, yellow and magenta are under 3:1 on white,
// so every segment is also named in the list beside the bar.
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const OTHER = "#b4b2a9";
const INK_ON = (hex: string) => (hex === "#eda100" ? "#0b0b0b" : "#ffffff");

function Stat({ label, value, sub, hint }: { label: string; value: React.ReactNode; sub?: string; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 font-sans text-lg font-semibold text-ink-900">{value}</dd>
      {sub && <dd className="text-xs text-gray-400">{sub}</dd>}
    </div>
  );
}

export function Overview({
  a,
  health,
  money,
  altMoney,
  holdingsCount,
  accountsCount,
  onOpenTab,
}: {
  a: Analysis;
  health: Health[];
  money: Money;
  altMoney: Money;
  holdingsCount: number;
  accountsCount: number;
  onOpenTab: (tab: string) => void;
}) {
  const t = a.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col justify-between gap-6 rounded-lg border bg-white p-5 lg:col-span-2">
          <div>
            <p className="text-sm text-gray-500">Portfolio value</p>
            <p className="mt-1 font-sans text-5xl font-semibold tracking-tight text-ink-900">{money(t.valueUsd)}</p>
            <p className="mt-1 text-sm text-gray-500">≈ {altMoney(t.valueUsd)}</p>
            <p className={`mt-3 text-sm font-medium ${tone(t.unrealizedUsd)}`}>
              {t.unrealizedUsd >= 0 ? "▲" : "▼"} {money(Math.abs(t.unrealizedUsd))} ({pctText(t.unrealizedPct)}){" "}
              <span className="font-normal text-gray-500">on what you still hold</span>
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-4 sm:grid-cols-4">
            <Stat label="Invested in what you hold" value={money(t.investedUsd)} />
            <Stat
              label="Return per year"
              value={t.xirr !== null ? <span className={tone(t.xirr)}>{pctText(t.xirr)}</span> : "—"}
              sub={t.xirr !== null ? "XIRR, all money in and out" : "Needs real buy dates"}
              hint="XIRR: counts when each rupee or dollar went in and came out."
            />
            <Stat
              label="Gains taken + dividends"
              value={<span className={tone(t.realizedUsd + t.dividendsUsd)}>{money(t.realizedUsd + t.dividendsUsd)}</span>}
              sub="From shares sold"
            />
            <Stat label="Holdings" value={holdingsCount} sub={`in ${accountsCount} account${accountsCount === 1 ? "" : "s"}`} />
          </dl>
        </div>
        <HealthCard items={health} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <div className="space-y-4 lg:col-span-2">
          <Allocation a={a} money={money} />
          <Insights items={a.insights} />
        </div>
        <TopHoldings rows={a.rows} money={money} onOpenTab={onOpenTab} />
      </div>
    </div>
  );
}

const STATUS: Record<HealthStatus, { label: string; icon: string; cls: string }> = {
  good: { label: "OK", icon: "✓", cls: "bg-[#e7f5e7] text-[#006300]" },
  watch: { label: "Watch", icon: "!", cls: "bg-[#fdf0d5] text-[#7a5200]" },
  act: { label: "Act", icon: "▲", cls: "bg-[#fbe4e4] text-[#a32b2b]" },
};

function HealthCard({ items }: { items: Health[] }) {
  return (
    <div className="rounded-lg border bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700">Health check</h2>
      <ul className="mt-3 space-y-2.5">
        {items.map((h) => {
          const s = STATUS[h.status];
          return (
            <li key={h.key} className="text-sm" title={h.note}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-700">{h.label}</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium tabular-nums text-ink-900">{h.value}</span>
                  <span className={`inline-flex w-[4.5rem] items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                    <span aria-hidden>{s.icon}</span>
                    {s.label}
                  </span>
                </span>
              </div>
              <p className="text-xs text-gray-400">{h.note}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const DIMENSIONS = [
  ["byCountry", "Country"],
  ["byAssetType", "Type"],
  ["bySector", "Sector"],
  ["byAccount", "Account"],
] as const;

function Allocation({ a, money }: { a: Analysis; money: Money }) {
  const [dim, setDim] = useState<(typeof DIMENSIONS)[number][0]>("byCountry");
  const all: Slice[] = a[dim];
  // Up to six parts; the rest folds into "Other".
  const parts = all.length > 6 ? [...all.slice(0, 5), { key: "__other", label: "Other", valueUsd: all.slice(5).reduce((s, x) => s + x.valueUsd, 0), weight: all.slice(5).reduce((s, x) => s + x.weight, 0) }] : all;
  const colorOf = (i: number, key: string) => (key === "__other" ? OTHER : SERIES[i]);
  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">How it&apos;s split</h2>
        <div role="tablist" aria-label="Split by" className="inline-flex rounded-md border bg-gray-50 p-0.5 text-xs">
          {DIMENSIONS.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={dim === k}
              onClick={() => setDim(k)}
              className={`rounded px-2.5 py-1 ${dim === k ? "bg-white font-medium text-ink-900 shadow-sm" : "text-gray-500 hover:text-ink-900"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex h-7 w-full gap-0.5" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round(p.weight * 100)}%`).join(", ")}>
        {parts.map((p, i) =>
          p.weight > 0 ? (
            <div
              key={p.key}
              className="flex h-7 items-center overflow-hidden rounded px-1.5 text-xs font-medium"
              style={{ width: `${p.weight * 100}%`, background: colorOf(i, p.key), color: INK_ON(colorOf(i, p.key)) }}
              title={`${p.label}: ${money(p.valueUsd)} (${Math.round(p.weight * 100)}%)`}
            >
              {p.weight >= 0.12 ? `${Math.round(p.weight * 100)}%` : ""}
            </div>
          ) : null,
        )}
      </div>
      <ul className="mt-4 divide-y text-sm">
        {parts.map((p, i) => (
          <li key={p.key} className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorOf(i, p.key) }} />
              <span className="truncate text-gray-700">{p.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-gray-600">
              {money(p.valueUsd)} <span className="ml-2 inline-block w-10 text-right text-gray-400">{Math.round(p.weight * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopHoldings({ rows, money, onOpenTab }: { rows: HoldingRow[]; money: Money; onOpenTab: (tab: string) => void }) {
  const open = rows.filter((r) => !r.closed).sort((x, y) => y.valueUsd - x.valueUsd);
  const top = open.slice(0, 6);
  const max = top[0]?.weight || 1;
  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Biggest holdings</h2>
        <button onClick={() => onOpenTab("holdings")} className="text-xs text-brand-600 hover:underline">
          All {open.length} →
        </button>
      </div>
      <ul className="mt-3 space-y-3">
        {top.map((r) => (
          <li key={r.id} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-gray-700">{r.name || r.symbol}</span>
              <span className="shrink-0 tabular-nums text-gray-600">
                {money(r.valueUsd)}
                <span className={`ml-2 text-xs ${tone(r.gainPct)}`}>{pctText(r.gainPct, 0)}</span>
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(r.weight / max) * 100}%` }} />
              </div>
              <span className="w-9 text-right text-xs tabular-nums text-gray-400">{Math.round(r.weight * 100)}%</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ORDER: Record<Insight["level"], number> = { warn: 0, good: 1, info: 2 };

function Insights({ items }: { items: Insight[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const sorted = [...items].sort((x, y) => ORDER[x.level] - ORDER[y.level]);
  const shown = all ? sorted : sorted.slice(0, 4);
  const label = { warn: "Watch", good: "Opportunity", info: "Note" };
  const cls = { warn: STATUS.watch.cls, good: STATUS.good.cls, info: "bg-ink-50 text-ink-600" };
  return (
    <div className="rounded-lg border bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700">What stands out</h2>
      <ul className="mt-3 space-y-3">
        {shown.map((x, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls[x.level]}`}>{label[x.level]}</span>
            <span className="text-gray-700">{x.text}</span>
          </li>
        ))}
      </ul>
      {sorted.length > 4 && (
        <button onClick={() => setAll(!all)} className="mt-3 text-xs text-brand-600 hover:underline">
          {all ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
      <p className="mt-4 text-xs text-gray-400">
        Observations, not advice. Tax rules as of 2026: India long-term (over 12 months) equity gains 12.5% above ₹1.25 lakh a year, short-term 20%; US
        long-term (over a year) 0/15/20%, short-term at your income rate.
      </p>
    </div>
  );
}
