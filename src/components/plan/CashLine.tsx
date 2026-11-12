"use client";

import { useState } from "react";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/formatDate";
import type { PlanDay } from "@/lib/cashPlan";

// The bank balance day by day for the next 30 days: the cushion as a dashed
// line, days under it shaded red, paydays marked. Touch or hover a day to
// read it.
export default function CashLine({ timeline, cushion, today }: { timeline: PlanDay[]; cushion: number; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (timeline.length < 2) return null;
  const W = 320, H = 120, P = 6;
  const vals = timeline.map((d) => d.balance);
  const max = Math.max(...vals, cushion, 1);
  const min = Math.min(...vals, 0);
  const x = (i: number) => P + (i / (timeline.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  // A step line: the balance holds all day and moves on the day's events.
  const path = timeline.map((d, i) => `${i ? `L ${x(i).toFixed(1)} ${y(vals[i - 1]).toFixed(1)} ` : "M "}${x(i).toFixed(1)} ${y(d.balance).toFixed(1)}`).join(" ");
  const at = hover ?? 0;
  const d = timeline[at];
  return (
    <div className="mt-3 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span className="font-medium uppercase tracking-wide">Bank cash</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 bg-ink-900" /> Balance
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0 w-3 border-t border-dashed border-expense-600" /> Cushion
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-income-600" /> Payday
          </span>
        </span>
      </div>
      <div
        className="relative mt-1 h-28 w-full touch-none sm:h-36"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round((((e.clientX - r.left) / r.width) * W - P) / ((W - 2 * P) / (timeline.length - 1)));
          setHover(Math.max(0, Math.min(timeline.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Bank cash over the next ${timeline.length} days, lowest ${money(Math.min(...vals), "USD", 0)}`}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* Shade the days under the cushion. */}
          {timeline.map((t, i) =>
            t.balance < cushion ? (
              <rect key={t.date} x={x(Math.max(0, i - 0.5))} width={x(Math.min(timeline.length - 1, i + 0.5)) - x(Math.max(0, i - 0.5))} y={P} height={H - 2 * P} fill="#FEE2E2" />
            ) : null,
          )}
          {min < 0 && <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="#9CA3AF" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          <line x1={P} x2={W - P} y1={y(cushion)} y2={y(cushion)} stroke="#B91C1C" strokeOpacity={0.7} strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke="#1C2B3A" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {hover != null && <line x1={x(at)} x2={x(at)} y1={P} y2={H - P} stroke="#1C2B3A" strokeOpacity={0.25} vectorEffect="non-scaling-stroke" />}
        </svg>
        {timeline.map((t, i) =>
          t.events.some((e) => e.kind === "PAYCHECK") ? (
            <span key={t.date} className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-income-600" style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(t.balance) / H) * 100}%` }} />
          ) : null,
        )}
        {hover != null && (
          <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-900" style={{ left: `${(x(at) / W) * 100}%`, top: `${(y(d.balance) / H) * 100}%` }} />
        )}
      </div>
      <p className="text-xs text-gray-600">
        {hover == null ? (
          <>Touch the line to see a day.</>
        ) : (
          <>
            {d.date === today ? "Today" : formatDate(d.date, { weekday: "short", month: "short", day: "numeric" })}: <b className={`tabular-nums ${d.balance < cushion ? "text-expense-600" : ""}`}>{money(d.balance, "USD", 0)}</b>
            {d.events.length > 0 && <span className="text-gray-400"> · {d.events.map((e) => e.label).join(", ")}</span>}
          </>
        )}
      </p>
    </div>
  );
}
