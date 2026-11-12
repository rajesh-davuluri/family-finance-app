"use client";

import { useState } from "react";
import { money } from "@/lib/money";

// Small dashboard pieces: change against last month, how income was split
// (50/30/20), and spending day by day against last month.

const usd = (n: number) => money(n, "USD", 0);

// "▲ 12%" against last month by the same day. `upIsGood` sets the colour:
// more income or more kept is good, more spending isn't.
export function ChangeBadge({ now, before, upIsGood }: { now: number; before: number | null | undefined; upIsGood: boolean }) {
  if (before == null || Math.abs(before) < 1) return null;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  if (!Number.isFinite(pct)) return null;
  const flat = Math.abs(pct) < 3;
  const good = flat ? null : (pct > 0) === upIsGood;
  const cls = flat ? "bg-gray-100 text-gray-600" : good ? "bg-green-50 text-income-600" : "bg-red-50 text-expense-600";
  return (
    <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${cls}`} title="Against last month by the same day">
      {flat ? "≈ same" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`}
    </span>
  );
}

// How income was used: needs (rent, EMIs, bills, groceries, gas...), wants
// (everything else spent) and what was kept, against the 50/30/20 rule.
export function IncomeSplitGauge({ income, needs, spent }: { income: number; needs: number; spent: number }) {
  if (income <= 0) {
    return <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">No income recorded in this period yet, so the 50/30/20 split shows once a paycheck lands.</p>;
  }
  const wants = Math.max(0, spent - needs);
  const saved = income - spent;
  const parts = [
    { key: "needs", label: "Needs", value: needs, target: "≤ 50%", ok: needs / income <= 0.5, color: "#1C2B3A" },
    { key: "wants", label: "Wants", value: wants, target: "≤ 30%", ok: wants / income <= 0.3, color: "#C99F3F" },
    { key: "saved", label: "Kept", value: Math.max(0, saved), target: "≥ 20%", ok: saved / income >= 0.2, color: "#4B7B5A" },
  ];
  // Half-circle arcs, each its share of income (spending past income fills it).
  const total = Math.max(income, needs + wants);
  const R = 80, CX = 100, CY = 95, W = 22;
  let start = Math.PI;
  const arcs = parts.map((p) => {
    const sweep = (p.value / total) * Math.PI;
    const a0 = start, a1 = start + sweep;
    start = a1;
    const pt = (a: number) => `${CX + R * Math.cos(a)} ${CY + R * Math.sin(a)}`;
    return sweep > 0.001 ? { ...p, d: `M ${pt(a0)} A ${R} ${R} 0 ${sweep > Math.PI ? 1 : 0} 1 ${pt(a1)}` } : null;
  });
  const pct = (v: number) => Math.round((v / income) * 100);
  return (
    <div className="mt-3 flex flex-col items-center gap-3 rounded-lg bg-paper px-3 py-3 sm:flex-row sm:items-center">
      <svg viewBox="0 0 200 105" className="w-48 shrink-0" role="img" aria-label={`Needs ${pct(needs)}%, wants ${pct(wants)}%, kept ${pct(saved)}% of income`}>
        <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} fill="none" stroke="#E5E7EB" strokeWidth={W} />
        {arcs.map((a) => a && <path key={a.key} d={a.d} fill="none" stroke={a.color} strokeWidth={W} />)}
        <text x={CX} y={CY - 30} textAnchor="middle" className="fill-gray-500" style={{ fontSize: 11 }}>
          of {usd(income)} income
        </text>
        <text x={CX} y={CY - 6} textAnchor="middle" className="fill-ink-900" style={{ fontSize: 20, fontWeight: 600 }}>
          {pct(saved)}% kept
        </text>
      </svg>
      <ul className="w-full space-y-1.5 text-sm sm:max-w-md">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
              {p.label}
              <span className="text-xs text-gray-400">target {p.target}</span>
            </span>
            <span className={`tabular-nums ${p.ok ? "" : "font-medium text-expense-600"}`}>
              {p.key === "saved" ? pct(saved) : pct(p.value)}% · {usd(p.key === "saved" ? saved : p.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Spending added up day by day: this month (to today) against last month.
export function DailySpendLine({ thisMonth, lastMonth, daysInMonth }: { thisMonth: number[]; lastMonth: number[]; daysInMonth: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (thisMonth.length === 0 || lastMonth.length === 0) return null;
  const days = Math.max(daysInMonth, lastMonth.length);
  const max = Math.max(...thisMonth, ...lastMonth, 1);
  const W = 320, H = 120, P = 6;
  const x = (i: number) => P + (i / (days - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = (xs: number[]) => xs.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const today = thisMonth.length - 1;
  const at = hover ?? today;
  const nowV = thisMonth[Math.min(at, today)];
  const lastV = lastMonth[Math.min(at, lastMonth.length - 1)];
  const diff = nowV - lastV;
  return (
    <div className="mt-3 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-wide text-gray-500">Spending by day</span>
        <span className="flex items-center gap-3 text-gray-500">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 bg-brand-500" /> This month
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 bg-gray-400" /> Last month
          </span>
        </span>
      </div>
      {/* Fixed height at any width: the drawing stretches, the dots are
          placed over it so they stay round. */}
      <div
        className="relative mt-1 h-28 w-full touch-none sm:h-32"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round((((e.clientX - r.left) / r.width) * W - P) / ((W - 2 * P) / (days - 1)));
          setHover(Math.max(0, Math.min(days - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`By day ${at + 1}: ${usd(nowV)} this month, ${usd(lastV)} last month`}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <path d={line(lastMonth)} fill="none" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <path d={line(thisMonth)} fill="none" stroke="#B8860B" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <line x1={x(at)} x2={x(at)} y1={P} y2={H - P} stroke="#1C2B3A" strokeOpacity={0.25} vectorEffect="non-scaling-stroke" />
        </svg>
        {at <= today && <Dot left={x(at) / W} top={y(nowV) / H} size={8} color="#B8860B" />}
        <Dot left={x(at) / W} top={y(lastV) / H} size={7} color="#9CA3AF" />
      </div>
      <p className="text-xs text-gray-600">
        By day {at + 1}: <b className="tabular-nums">{at <= today ? usd(nowV) : "—"}</b> this month vs <span className="tabular-nums">{usd(lastV)}</span> last month
        {at <= today && Math.abs(diff) >= 1 && (
          <span className={diff > 0 ? "text-expense-600" : "text-income-600"}> ({diff > 0 ? "+" : "−"}{usd(Math.abs(diff))})</span>
        )}
        .
      </p>
    </div>
  );
}

function Dot({ left, top, size, color }: { left: number; top: number; size: number; color: string }) {
  return (
    <span
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: size, height: size, background: color }}
    />
  );
}
