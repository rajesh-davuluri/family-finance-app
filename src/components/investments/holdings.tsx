"use client";

// Holdings tab: every holding across accounts in one list -- filter by
// country, account or search, sort, and open one for its trades. A table on
// wide screens, cards on a phone.

import { Fragment, useMemo, useState } from "react";
import { ASSET_TYPE_LABELS, COUNTRY_LABELS, fmtMoney, type HoldingRow } from "@/lib/investments";
import { HoldingDetail } from "./forms";
import { pctText, priceDigits, qtyText, tone, type Account, type HoldingJson } from "./shared";
import type { Money } from "./overview";

type SortKey = "value" | "gainPct" | "gain" | "name";
const SORTS: [SortKey, string][] = [
  ["value", "Value"],
  ["gainPct", "Gain %"],
  ["gain", "Gain"],
  ["name", "Name"],
];

function termOf(r: HoldingRow) {
  if (r.closed || r.value === null) return null;
  const lt = r.longTermGain !== null && Math.abs(r.longTermGain) > 0.005;
  const st = r.shortTermGain !== null && Math.abs(r.shortTermGain) > 0.005;
  if (r.nextLongTerm) return `${lt ? "Mixed" : "Short"} · long in ${r.nextLongTerm.days}d`;
  return lt && st ? "Mixed" : st ? "Short-term" : "Long-term";
}

const display = (h: HoldingJson) => (h.exchange === "AMFI" && h.name ? h.name : h.name || h.symbol);

export function HoldingsTab({
  accounts,
  rowOf,
  money,
  today,
  onChanged,
}: {
  accounts: Account[];
  rowOf: Map<string, HoldingRow>;
  money: Money;
  today: string;
  onChanged: () => void;
}) {
  const [country, setCountry] = useState("ALL");
  const [accountId, setAccountId] = useState("ALL");
  const [showSold, setShowSold] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("value");
  const [open, setOpen] = useState<string | null>(null);

  const all = useMemo(
    () =>
      accounts
        .filter((a) => !a.archived)
        .flatMap((a) => a.holdings.map((h) => ({ h, a, r: rowOf.get(h.id) })))
        .filter((x): x is { h: HoldingJson; a: Account; r: HoldingRow } => !!x.r),
    [accounts, rowOf],
  );
  const countries = [...new Set(all.map((x) => x.a.country))];
  const query = q.trim().toLowerCase();
  const list = all
    .filter((x) => (country === "ALL" || x.a.country === country) && (accountId === "ALL" || x.a.id === accountId))
    .filter((x) => !query || x.h.symbol.toLowerCase().includes(query) || (x.h.name ?? "").toLowerCase().includes(query))
    .sort((x, y) => {
      if (sort === "name") return display(x.h).localeCompare(display(y.h));
      if (sort === "gainPct") return (y.r.gainPct ?? -Infinity) - (x.r.gainPct ?? -Infinity);
      if (sort === "gain") return (y.r.gain ?? 0) * (y.r.valueUsd / (y.r.value || 1)) - (x.r.gain ?? 0) * (x.r.valueUsd / (x.r.value || 1));
      return y.r.valueUsd - x.r.valueUsd;
    });
  const held = list.filter((x) => !x.r.closed);
  const sold = list.filter((x) => x.r.closed);
  const totalUsd = held.reduce((s, x) => s + x.r.valueUsd, 0);
  const investedUsd = held.reduce((s, x) => s + x.r.investedUsd, 0);
  const toggle = (id: string) => setOpen(open === id ? null : id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
        <div role="tablist" aria-label="Country" className="inline-flex rounded-md border bg-gray-50 p-0.5 text-xs">
          {["ALL", ...countries].map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={country === c}
              onClick={() => setCountry(c)}
              className={`rounded px-2.5 py-1 ${country === c ? "bg-white font-medium text-ink-900 shadow-sm" : "text-gray-500 hover:text-ink-900"}`}
            >
              {c === "ALL" ? "All" : COUNTRY_LABELS[c]}
            </button>
          ))}
        </div>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-md border px-2 py-1.5 text-xs" aria-label="Account">
          <option value="ALL">All accounts</option>
          {accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-md border px-2 py-1.5 text-xs" aria-label="Sort by">
          {SORTS.map(([k, l]) => (
            <option key={k} value={k}>
              Sort: {l}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          aria-label="Search holdings"
          className="w-32 rounded-md border px-2 py-1.5 text-xs sm:w-40"
        />
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={showSold} onChange={(e) => setShowSold(e.target.checked)} />
          Show sold ({all.filter((x) => x.r.closed).length})
        </label>
      </div>

      <p className="px-1 text-sm text-gray-600">
        {held.length} holding{held.length === 1 ? "" : "s"} · worth <span className="font-medium text-ink-900">{money(totalUsd)}</span> ·{" "}
        <span className={tone(totalUsd - investedUsd)}>
          {totalUsd >= investedUsd ? "up" : "down"} {money(Math.abs(totalUsd - investedUsd))}
          {investedUsd > 0 ? ` (${pctText((totalUsd - investedUsd) / investedUsd)})` : ""}
        </span>
      </p>

      {/* Phone: cards. */}
      <div className="space-y-2 md:hidden">
        {[...held, ...(showSold ? sold : [])].map(({ h, a, r }) => (
          <div key={h.id} className="rounded-lg border bg-white">
            <button onClick={() => toggle(h.id)} className="flex w-full items-start justify-between gap-3 p-3 text-left">
              <span className="min-w-0">
                <span className="block truncate font-medium">{display(h)}</span>
                <span className="block text-xs text-gray-500">
                  {h.symbol} · {a.name}
                  {r.closed ? " · sold" : ` · ${qtyText(r.quantity)} @ ${fmtMoney(h.currency, r.avgCost, priceDigits(r.avgCost))}`}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {r.closed ? (
                  <span className={`block text-sm ${tone(r.realizedGain)}`}>{fmtMoney(h.currency, r.realizedGain)}</span>
                ) : (
                  <>
                    <span className="block text-sm font-medium">{fmtMoney(h.currency, r.value ?? r.invested)}</span>
                    <span className={`block text-xs ${tone(r.gain)}`}>
                      {r.gain !== null ? `${fmtMoney(h.currency, r.gain)} (${pctText(r.gainPct)})` : "no price"}
                    </span>
                  </>
                )}
              </span>
            </button>
            {open === h.id && (
              <div className="border-t bg-gray-50 p-3">
                <HoldingDetail h={h} r={r} today={today} onChanged={onChanged} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Wider screens: one table. */}
      <div className="hidden overflow-x-auto rounded-lg border bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="p-3 font-medium">Holding</th>
              <th className="p-3 text-right font-medium">Qty</th>
              <th className="p-3 text-right font-medium">Avg cost</th>
              <th className="p-3 text-right font-medium">Price</th>
              <th className="p-3 text-right font-medium">Value</th>
              <th className="p-3 text-right font-medium">Gain</th>
              <th className="p-3 font-medium">Term</th>
              <th className="p-3 font-medium">Weight</th>
              <th className="p-3 text-right font-medium">Per year</th>
            </tr>
          </thead>
          <tbody>
            {held.map(({ h, a, r }) => (
              <Fragment key={h.id}>
                <tr className="cursor-pointer border-b hover:bg-gray-50" onClick={() => toggle(h.id)}>
                  <td className="p-3">
                    <div className="max-w-[240px] truncate font-medium">{display(h)}</div>
                    <div className="max-w-[240px] truncate text-xs text-gray-500">
                      {h.symbol} · {a.name} · {[ASSET_TYPE_LABELS[h.assetType], h.sector].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="p-3 text-right tabular-nums">{qtyText(r.quantity)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtMoney(h.currency, r.avgCost, priceDigits(r.avgCost))}</td>
                  <td className="p-3 text-right tabular-nums">
                    {h.lastPrice !== null ? fmtMoney(h.currency, h.lastPrice, priceDigits(h.lastPrice)) : <span className="text-xs text-amber-700">no price</span>}
                    {h.lastPrice !== null && <div className="text-[10px] uppercase text-gray-400">{h.priceSource === "MANUAL" ? "typed in" : "live"}</div>}
                  </td>
                  <td className="p-3 text-right tabular-nums">{r.value !== null ? fmtMoney(h.currency, r.value) : "—"}</td>
                  <td className={`p-3 text-right tabular-nums ${tone(r.gain)}`}>
                    {r.gain !== null ? (
                      <>
                        {fmtMoney(h.currency, r.gain)}
                        <div className="text-xs">{pctText(r.gainPct)}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3 text-xs text-gray-600">{termOf(r) ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-gray-100">
                        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(100, r.weight * 100 * 2)}%` }} />
                      </div>
                      <span className="w-8 text-right text-xs tabular-nums text-gray-600">{Math.round(r.weight * 100)}%</span>
                    </div>
                  </td>
                  <td className={`p-3 text-right tabular-nums ${tone(r.xirr)}`}>
                    {r.xirr !== null ? pctText(r.xirr) : <span className="text-xs text-gray-400">{r.approxDates ? "dates approx." : "—"}</span>}
                  </td>
                </tr>
                {open === h.id && (
                  <tr className="border-b bg-gray-50">
                    <td colSpan={9} className="p-3">
                      <HoldingDetail h={h} r={r} today={today} onChanged={onChanged} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {showSold && sold.length > 0 && (
              <tr>
                <td colSpan={9} className="bg-gray-50 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                  Sold
                </td>
              </tr>
            )}
            {showSold &&
              sold.map(({ h, a, r }) => (
                <Fragment key={h.id}>
                  <tr className="cursor-pointer border-b hover:bg-gray-50" onClick={() => toggle(h.id)}>
                    <td className="p-3">
                      <div className="font-medium">{display(h)}</div>
                      <div className="text-xs text-gray-500">
                        {h.symbol} · {a.name}
                      </div>
                    </td>
                    <td colSpan={4} className="p-3 text-right text-xs text-gray-500">
                      All sold
                    </td>
                    <td className={`p-3 text-right tabular-nums ${tone(r.realizedGain)}`}>{fmtMoney(h.currency, r.realizedGain)}</td>
                    <td className="p-3 text-xs text-gray-500">realized</td>
                    <td />
                    <td className={`p-3 text-right tabular-nums ${tone(r.xirr)}`}>{r.xirr !== null ? pctText(r.xirr) : "—"}</td>
                  </tr>
                  {open === h.id && (
                    <tr className="border-b bg-gray-50">
                      <td colSpan={9} className="p-3">
                        <HoldingDetail h={h} r={r} today={today} onChanged={onChanged} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-400">
                  Nothing matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="px-1 text-xs text-gray-400">Weight bars are drawn to 50% of the portfolio. Click a holding for its buys, sales and dividends.</p>
    </div>
  );
}
