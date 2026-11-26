"use client";

// Performance tab: what the investing has earned -- against an index fund,
// winners and losers, and the track record per country.

import { COUNTRY_LABELS, fmtMoney, type CountryRecord, type HoldingRow } from "@/lib/investments";
import { pctText, qtyText, tone } from "./shared";
import type { Money } from "./overview";

// Diverging pair for gain/loss: blue and red read as opposite for every
// kind of color vision (green/red does not); signs and labels carry it too.
const GAIN = "#2a78d6";
const LOSS = "#e34948";

export function PerformanceTab({ records, rows, money }: { records: CountryRecord[]; rows: HoldingRow[]; money: Money }) {
  return (
    <div className="space-y-4">
      {records.some((r) => r.benchmark) && <Benchmark records={records} />}
      <WinnersLosers rows={rows} money={money} />
      {records.map((r) => (
        <TrackRecord key={r.country} r={r} />
      ))}
      {!records.length && <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-400">Add holdings with their buys to see performance.</p>}
    </div>
  );
}

// Your holdings against the same money in an index fund: two bars per
// country, yours in the accent, the index in gray.
function Benchmark({ records }: { records: CountryRecord[] }) {
  const rs = records.filter((r) => r.benchmark);
  return (
    <div className="rounded-lg border bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700">Your picks vs an index fund</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        The same money, put in and taken out on the same dates, growing at the index&apos;s long-run average. An assumption, not the exact index for these
        dates.
      </p>
      <div className={`mt-4 grid grid-cols-1 gap-6 ${rs.length > 1 ? "md:grid-cols-2" : ""}`}>
        {rs.map((r) => {
          const b = r.benchmark!;
          const max = Math.max(r.value, b.value) || 1;
          const diff = r.value - b.value;
          return (
            <div key={r.country}>
              <p className="text-sm font-medium text-gray-700">
                {COUNTRY_LABELS[r.country]} · since {new Date(`${r.since}T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
              </p>
              {[
                ["Your holdings", r.value, "#B8860B", r.xirr !== null ? `${pctText(r.xirr)} a year` : ""],
                [b.label, b.value, "#b4b2a9", `~${Math.round(b.rate * 100)}% a year`],
              ].map(([label, v, color, note]) => (
                <div key={label as string} className="mt-2">
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>{label as string}</span>
                    <span className="tabular-nums">
                      {fmtMoney(r.currency, v as number)} <span className="text-gray-400">{note as string}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-3 rounded-r" style={{ width: `${((v as number) / max) * 100}%`, background: color as string, borderRadius: "0 4px 4px 0" }} />
                </div>
              ))}
              <p className={`mt-2 text-sm ${tone(diff)}`}>
                {diff >= 0 ? "Ahead by " : "Behind by "}
                {fmtMoney(r.currency, Math.abs(diff))}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Total gain (held + sold) per holding, largest either way, as diverging
// bars around zero.
function WinnersLosers({ rows, money }: { rows: HoldingRow[]; money: Money }) {
  const items = rows
    .map((r) => {
      const native = (r.gain ?? 0) + r.realizedGain;
      const usd = r.value ? (r.valueUsd / r.value) * native : r.invested ? (r.investedUsd / r.invested) * native : 0;
      return { r, usd };
    })
    .filter((x) => Math.abs(x.usd) > 0.005)
    .sort((x, y) => y.usd - x.usd);
  if (!items.length) return null;
  const shown = items.length > 12 ? [...items.slice(0, 6), ...items.slice(-6)] : items;
  const max = Math.max(...shown.map((x) => Math.abs(x.usd)));
  const winners = items.filter((x) => x.usd > 0).length;
  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Winners and losers</h2>
        <p className="text-xs text-gray-500">
          {winners} of {items.length} made money · held and sold, in today&apos;s value
        </p>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: GAIN }} /> Gain
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: LOSS }} /> Loss
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {shown.map(({ r, usd }) => {
          const w = `${(Math.abs(usd) / max) * 50}%`;
          return (
            <li key={r.id} className="grid grid-cols-[minmax(0,9rem)_1fr_5.5rem] items-center gap-2 text-xs sm:grid-cols-[minmax(0,13rem)_1fr_6.5rem]" title={`${r.name || r.symbol}: ${money(usd)}`}>
              <span className="truncate text-gray-700">
                {r.name || r.symbol}
                {r.closed && <span className="text-gray-400"> · sold</span>}
              </span>
              <span className="relative h-3">
                <span className="absolute left-1/2 top-[-2px] h-4 w-px bg-gray-300" />
                <span
                  className="absolute top-0 h-3"
                  style={usd >= 0 ? { left: "50%", width: w, background: GAIN, borderRadius: "0 4px 4px 0" } : { right: "50%", width: w, background: LOSS, borderRadius: "4px 0 0 4px" }}
                />
              </span>
              <span className="text-right tabular-nums text-gray-700">
                {usd >= 0 ? "+" : "−"}
                {money(Math.abs(usd))}
              </span>
            </li>
          );
        })}
      </ul>
      {items.length > 12 && <p className="mt-2 text-xs text-gray-400">Top 6 and bottom 6 of {items.length}.</p>}
    </div>
  );
}

function TrackRecord({ r }: { r: CountryRecord }) {
  const c = r.currency;
  const m = (n: number) => fmtMoney(c, n);
  const since = new Date(`${r.since}T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const name = (p: { name: string | null; symbol: string }) => p.name || p.symbol;
  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">
        Your track record · {COUNTRY_LABELS[r.country]}
        {r.approx ? (
          <span className="ml-1 font-normal text-gray-400">(buy dates approximate)</span>
        ) : (
          <>
            {" "}
            since {since}
            <span className="ml-1 font-normal text-gray-400">({r.years.toFixed(1)} years)</span>
          </>
        )}
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        {(
          [
            ["Put in", m(r.bought), ""],
            ["Taken out", m(r.sold + r.dividends), ""],
            ["Worth now", m(r.value), ""],
            ["Net result", m(r.net), tone(r.net)],
            ["Return per year", r.xirr !== null ? pctText(r.xirr) : "—", tone(r.xirr)],
          ] as const
        ).map(([k, v, cls]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wide text-gray-500">{k}</dt>
            <dd className={`mt-0.5 font-sans text-base font-semibold ${cls || "text-gray-800"}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {r.benchmark && (
        <p className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
          The same money, put in and taken out on the same dates, in a {r.benchmark.label} (about {Math.round(r.benchmark.rate * 100)}% a year over
          the long run) would be worth about <strong>{m(r.benchmark.value)}</strong> today, against your {m(r.value)}
          {r.benchmark.value > r.value ? ` (${m(r.benchmark.value - r.value)} more).` : "."}
        </p>
      )}
      {r.approx && <p className="mt-2 text-xs text-gray-400">Some buy dates are approximate, so the yearly return and the comparison aren&apos;t shown.</p>}

      <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
        {r.best.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Best (per year)</h3>
            {r.best.map((p) => (
              <div key={p.symbol} className="flex justify-between gap-2 py-0.5">
                <span>
                  {name(p)}
                  {p.closed && <span className="text-xs text-gray-400"> · sold</span>}
                </span>
                <span className="tabular-nums text-income-600">
                  {pctText(p.xirr)} <span className="text-xs text-gray-500">({m(p.gain)})</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {r.worst.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Worst (per year)</h3>
            {r.worst.map((p) => (
              <div key={p.symbol} className="flex justify-between gap-2 py-0.5">
                <span>
                  {name(p)}
                  {p.closed && <span className="text-xs text-gray-400"> · sold</span>}
                </span>
                <span className="tabular-nums text-expense-600">
                  {pctText(p.xirr)} <span className="text-xs text-gray-500">({m(p.gain)})</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {r.soldEarly.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Sold too early</h3>
            {r.soldEarly.slice(0, 4).map((x) => (
              <div key={x.symbol} className="flex justify-between gap-2 py-0.5">
                <span>
                  {name(x)}: {qtyText(x.quantity)} sold at {fmtMoney(c, x.soldAt, 2)}, now {fmtMoney(c, x.priceNow, 2)}
                </span>
                <span className="tabular-nums text-gray-600">+{m(x.missed)}</span>
              </div>
            ))}
          </div>
        )}
        {(r.ipo || r.realizedByYear.length > 0) && (
          <div className="space-y-3">
            {r.ipo && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">IPOs</h3>
                <p>
                  {r.ipo.count} IPO{r.ipo.count === 1 ? "" : "s"}: put in {m(r.ipo.invested)}, worth {m(r.ipo.value)},{" "}
                  <span className={tone(r.ipo.gain)}>{m(r.ipo.gain)}</span>
                </p>
              </div>
            )}
            {r.realizedByYear.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Gains taken (sold)</h3>
                {r.realizedByYear.map((y) => (
                  <div key={y.label} className="flex justify-between gap-2 py-0.5">
                    <span>{y.label}</span>
                    <span className={`tabular-nums ${tone(y.gain)}`}>{m(y.gain)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {r.lessons.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Lessons</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {r.lessons.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-400">
        Worked out from the buys and sales recorded here. Index returns are long-run averages, not the exact index for these dates.
      </p>
    </div>
  );
}
