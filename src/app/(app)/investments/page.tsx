"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import {
  ACCOUNT_KINDS,
  ACCOUNT_KIND_LABELS,
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  COUNTRY_LABELS,
  EXCHANGES,
  EXCHANGE_LABELS,
  INDIA_LTCG_EXEMPTION,
  analyze,
  fmtMoney,
  type HoldingInput,
  type HoldingRow,
  type Slice,
  type Trade,
} from "@/lib/investments";

// Stocks, ETFs, mutual funds and crypto in India and the US: holdings built
// from their buys and sales, valued at live prices, with gains split into
// long and short term, returns, allocation and an analyst's observations.

type TradeJson = Trade & { id: string; notes: string | null };
type HoldingJson = {
  id: string;
  symbol: string;
  name: string | null;
  exchange: string;
  assetType: string;
  sector: string | null;
  currency: string;
  lastPrice: number | null;
  lastPriceAt: string | null;
  priceSource: string | null;
  notes: string | null;
  trades: TradeJson[];
};
type Account = {
  id: string;
  name: string;
  broker: string | null;
  country: string;
  currency: string;
  kind: string;
  owner: string | null;
  loginNote: string | null;
  notes: string | null;
  archived: boolean;
  holdings: HoldingJson[];
};
type Fx = { USDINR: number; updatedAt: string | null; live: boolean };

const input = "w-full rounded-md border px-3 py-2 text-sm";
const SECTORS = [
  "Banking & Finance",
  "Technology",
  "Energy",
  "FMCG / Consumer",
  "Healthcare & Pharma",
  "Auto",
  "Industrials",
  "Metals & Mining",
  "Telecom",
  "Real Estate",
  "Utilities",
  "Index / Diversified",
  "Crypto",
];

const pctText = (n: number | null, digits = 1) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`);
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, ""));
const tone = (n: number | null) => (n === null ? "" : n >= 0 ? "text-income-600" : "text-expense-600");
const priceDigits = (n: number) => (n < 10 ? 4 : 2);

function errorText(body: { error?: unknown }, fallback: string) {
  if (typeof body.error === "string") return body.error;
  const e = body.error as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
  const first = e?.fieldErrors && Object.entries(e.fieldErrors)[0];
  return first ? `${first[0]}: ${first[1][0]}` : (e?.formErrors?.[0] ?? fallback);
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export default function InvestmentsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fx, setFx] = useState<Fx>({ USDINR: 94.3, updatedAt: null, live: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | "new" | null>(null);
  const [addingHolding, setAddingHolding] = useState<string | true | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const today = getTodayLocal();

  async function load() {
    const res = await fetch("/api/investments");
    if (res.ok) {
      const body = await res.json();
      setAccounts(body.accounts);
      setFx(body.fx);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function refreshPrices() {
    setRefreshing(true);
    setMessage(null);
    const { ok, json } = await send("/api/investments/prices", "POST");
    setRefreshing(false);
    if (!ok) return setMessage("Couldn't refresh prices.");
    const failed = (json.failed as { symbol: string; reason: string }[]) ?? [];
    setMessage(
      `Updated ${json.updated} price${json.updated === 1 ? "" : "s"}${json.usdInr ? ` · $1 = ₹${Number(json.usdInr).toFixed(2)}` : ""}.` +
        (failed.length ? ` Not found: ${failed.map((f) => `${f.symbol} (${f.reason})`).join(", ")}. Check the symbol or type a price in.` : ""),
    );
    load();
  }

  const inputs: HoldingInput[] = useMemo(
    () =>
      accounts
        .filter((a) => !a.archived)
        .flatMap((a) =>
          a.holdings.map((h) => ({
            id: h.id,
            symbol: h.symbol,
            name: h.name,
            exchange: h.exchange,
            assetType: h.assetType,
            sector: h.sector,
            currency: h.currency,
            country: a.country,
            accountId: a.id,
            accountName: a.name,
            price: h.lastPrice,
            priceAt: h.lastPriceAt,
            priceSource: h.priceSource,
            trades: h.trades,
          })),
        ),
    [accounts],
  );
  const a = useMemo(() => analyze(inputs, fx, today), [inputs, fx, today]);
  const rowOf = useMemo(() => new Map(a.rows.map((r) => [r.id, r])), [a]);
  const lastRefresh = accounts
    .flatMap((x) => x.holdings)
    .filter((h) => h.priceSource === "LIVE" && h.lastPriceAt)
    .map((h) => h.lastPriceAt!)
    .sort()
    .pop();
  const hasHoldings = inputs.length > 0;
  const t = a.totals;

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Investments</h1>
          <p className="text-sm text-gray-500">
            Stocks, ETFs, mutual funds and crypto in India and the US: what they&apos;re worth, what you&apos;ve made, and what to watch.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasHoldings && (
            <button onClick={refreshPrices} disabled={refreshing} className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50">
              {refreshing ? "Refreshing..." : "Refresh prices"}
            </button>
          )}
          <button onClick={() => setEditingAccount("new")} className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
            Add account
          </button>
          {accounts.some((x) => !x.archived) && (
            <button
              onClick={() => setAddingHolding(true)}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Add holding
            </button>
          )}
        </div>
      </div>

      {message && <p className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">{message}</p>}

      {accounts.length === 0 && (
        <div className="rounded-lg border bg-white p-6 text-sm text-gray-600">
          <p className="font-medium text-gray-800">Get started in three steps</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              <strong>Add an account</strong> for each place you invest: Zerodha or Groww (India), Robinhood or Fidelity (US), a 401(k),
              Cybrid for crypto.
            </li>
            <li>
              <strong>Add your holdings</strong>: the symbol (RELIANCE, AAPL), how many you bought, the price and the date. Several buys of
              the same stock? Add the first, then &quot;Add buy&quot; for each one: dates matter for long-term vs short-term tax.
            </li>
            <li>
              <strong>Refresh prices</strong>: live from NSE/BSE, US exchanges and AMFI (mutual fund NAVs).
            </li>
          </ol>
        </div>
      )}

      {hasHoldings && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Worth today">
              <div>{fmtMoney("USD", t.valueUsd)}</div>
              <div className="text-sm font-normal text-gray-500">≈ {fmtMoney("INR", t.valueInr)}</div>
            </Tile>
            <Tile label="Invested (still held)">{fmtMoney("USD", t.investedUsd)}</Tile>
            <Tile label="Gain not yet sold">
              <span className={tone(t.unrealizedUsd)}>{fmtMoney("USD", t.unrealizedUsd)}</span>{" "}
              <span className={`text-sm font-normal ${tone(t.unrealizedUsd)}`}>{pctText(t.unrealizedPct)}</span>
            </Tile>
            <Tile label="Return per year" hint="XIRR: counts when each rupee or dollar went in. Shown once money has been in a year.">
              {t.xirr !== null ? <span className={tone(t.xirr)}>{pctText(t.xirr)}</span> : "—"}
            </Tile>
            <Tile label="Sold gains + dividends">
              <span className={tone(t.realizedUsd + t.dividendsUsd)}>{fmtMoney("USD", t.realizedUsd + t.dividendsUsd)}</span>
            </Tile>
          </div>
          <p className="-mt-3 text-xs text-gray-400">
            Totals in USD at $1 = ₹{fx.USDINR.toFixed(2)}
            {fx.live && fx.updatedAt ? ` (as of ${formatDate(fx.updatedAt)})` : " (approximate: refresh prices for today's rate)"}.
            {lastRefresh && ` Prices last refreshed ${new Date(lastRefresh).toLocaleString()}.`}
          </p>

          {a.countries.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {a.countries.map((c) => (
                <div key={c.country} className="rounded-lg border bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">{COUNTRY_LABELS[c.country]}</p>
                  <p className="font-display mt-1 text-lg font-semibold text-gray-800">{fmtMoney(c.currency, c.value)}</p>
                  <p className="text-sm text-gray-500">
                    Invested {fmtMoney(c.currency, c.invested)} ·{" "}
                    <span className={tone(c.gain)}>
                      {c.gain >= 0 ? "up" : "down"} {fmtMoney(c.currency, Math.abs(c.gain))} ({pctText(c.gainPct)})
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}

          {a.insights.length > 0 && (
            <div className="rounded-lg border bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-gray-700">What stands out</h2>
              <ul className="space-y-2">
                {a.insights.map((x, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${x.level === "warn" ? "bg-amber-500" : x.level === "good" ? "bg-income-500" : "bg-brand-400"}`}
                    />
                    <span className="text-gray-700">{x.text}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-gray-400">
                Observations, not advice. Tax rules as of 2026: India long-term (over 12 months) equity gains 12.5% above ₹1.25 lakh a year,
                short-term 20%; US long-term (over a year) 0/15/20%, short-term at your income rate.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Bars title="By type" slices={a.byAssetType} />
            <Bars title="By sector" slices={a.bySector} />
            <Bars title="By account" slices={a.byAccount} />
          </div>

          <TaxPanel a={a} />
        </>
      )}

      {accounts.map((acc) => (
        <AccountSection
          key={acc.id}
          account={acc}
          rowOf={rowOf}
          open={open}
          setOpen={setOpen}
          today={today}
          onEdit={() => setEditingAccount(acc)}
          onAddHolding={() => setAddingHolding(acc.id)}
          onChanged={load}
        />
      ))}

      {editingAccount && (
        <AccountForm
          account={editingAccount === "new" ? null : editingAccount}
          onClose={() => setEditingAccount(null)}
          onSaved={() => {
            setEditingAccount(null);
            load();
          }}
        />
      )}
      {addingHolding && (
        <HoldingForm
          accounts={accounts.filter((x) => !x.archived)}
          accountId={addingHolding === true ? null : addingHolding}
          today={today}
          onClose={() => setAddingHolding(null)}
          onSaved={(id) => {
            setAddingHolding(null);
            setOpen(id);
            load();
          }}
        />
      )}
    </div>
  );
}

function Tile({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-4" title={hint}>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <div className="font-display mt-1 text-lg font-semibold text-gray-800">{children}</div>
    </div>
  );
}

function Bars({ title, slices }: { title: string; slices: Slice[] }) {
  const shown = slices.slice(0, 6);
  const rest = slices.slice(6).reduce((s, x) => s + x.weight, 0);
  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-700">{title}</h3>
      <ul className="space-y-1.5">
        {shown.map((s) => (
          <li key={s.key} className="text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate text-gray-700">{s.label}</span>
              <span className="tabular-nums text-gray-500">{Math.round(s.weight * 100)}%</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-gray-100">
              <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.max(2, s.weight * 100)}%` }} />
            </div>
          </li>
        ))}
        {rest > 0 && <li className="text-xs text-gray-400">Others {Math.round(rest * 100)}%</li>}
      </ul>
    </div>
  );
}

function TaxPanel({ a }: { a: ReturnType<typeof analyze> }) {
  const india = a.rows.filter((r) => r.country === "IN" && !r.closed && r.value !== null);
  const us = a.rows.filter((r) => r.country === "US" && !r.closed && r.value !== null);
  const sum = (rs: HoldingRow[], k: "longTermGain" | "shortTermGain") => rs.reduce((s, r) => s + (r[k] ?? 0), 0);
  const used = Math.max(0, a.realizedIndia.lt);
  if (!india.length && !us.length && !a.realizedIndia.lt && !a.realizedUs.lt) return null;
  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Tax view</h2>
      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        {(india.length > 0 || a.realizedIndia.lt || a.realizedIndia.st) && (
          <div>
            <p className="font-medium text-gray-700">India · {a.realizedIndia.label}</p>
            <dl className="mt-1 space-y-0.5 text-gray-600">
              <Row k="Not sold: long-term gain" v={fmtMoney("INR", sum(india, "longTermGain"))} />
              <Row k="Not sold: short-term gain" v={fmtMoney("INR", sum(india, "shortTermGain"))} />
              <Row k="Sold this year: long-term" v={fmtMoney("INR", a.realizedIndia.lt)} />
              <Row k="Sold this year: short-term" v={fmtMoney("INR", a.realizedIndia.st)} />
              <Row
                k="Tax-free long-term left this year"
                v={fmtMoney("INR", Math.max(0, INDIA_LTCG_EXEMPTION - used))}
                note={`of ₹1,25,000`}
              />
            </dl>
          </div>
        )}
        {(us.length > 0 || a.realizedUs.lt || a.realizedUs.st) && (
          <div>
            <p className="font-medium text-gray-700">USA · {a.realizedUs.label}</p>
            <dl className="mt-1 space-y-0.5 text-gray-600">
              <Row k="Not sold: long-term gain" v={fmtMoney("USD", sum(us, "longTermGain"))} />
              <Row k="Not sold: short-term gain" v={fmtMoney("USD", sum(us, "shortTermGain"))} />
              <Row k="Sold this year: long-term" v={fmtMoney("USD", a.realizedUs.lt)} />
              <Row k="Sold this year: short-term" v={fmtMoney("USD", a.realizedUs.st)} />
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="tabular-nums text-gray-800">
        {v}
        {note && <span className="ml-1 text-xs text-gray-400">{note}</span>}
      </dd>
    </div>
  );
}

function AccountSection({
  account: acc,
  rowOf,
  open,
  setOpen,
  today,
  onEdit,
  onAddHolding,
  onChanged,
}: {
  account: Account;
  rowOf: Map<string, HoldingRow>;
  open: string | null;
  setOpen: (id: string | null) => void;
  today: string;
  onEdit: () => void;
  onAddHolding: () => void;
  onChanged: () => void;
}) {
  const rows = acc.holdings.map((h) => ({ h, r: rowOf.get(h.id) }));
  const held = rows.filter((x) => !x.r?.closed);
  const sold = rows.filter((x) => x.r?.closed);
  const value = held.reduce((s, x) => s + (x.r?.value ?? x.r?.invested ?? 0), 0);
  return (
    <div className={`rounded-lg border bg-white ${acc.archived ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b p-4">
        <div className="min-w-0">
          <p className="font-medium">
            {acc.name}
            <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{COUNTRY_LABELS[acc.country]}</span>
            <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{ACCOUNT_KIND_LABELS[acc.kind]}</span>
            {acc.archived && <span className="ml-1 text-xs text-gray-500">(archived)</span>}
          </p>
          <p className="text-xs text-gray-500">
            {[acc.broker, acc.owner && `Owner: ${acc.owner}`, acc.loginNote && `Login: ${acc.loginNote}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {held.length > 0 && <span className="font-display font-semibold text-gray-800">{fmtMoney(acc.currency, value)}</span>}
          {!acc.archived && (
            <button onClick={onAddHolding} className="text-xs text-brand-600 hover:underline">
              Add holding
            </button>
          )}
          <button onClick={onEdit} className="text-xs text-gray-500 hover:underline">
            Edit
          </button>
        </div>
      </div>
      {acc.holdings.length === 0 ? (
        <p className="p-4 text-sm text-gray-400">No holdings yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="p-3">Holding</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Avg cost</th>
                <th className="p-3 text-right">Price</th>
                <th className="p-3 text-right">Value</th>
                <th className="p-3 text-right">Gain</th>
                <th className="p-3">Term</th>
                <th className="p-3 text-right">Weight</th>
                <th className="p-3 text-right">Per year</th>
              </tr>
            </thead>
            <tbody>
              {held.map(({ h, r }) => (
                <HoldingRowView key={h.id} h={h} r={r} open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} today={today} onChanged={onChanged} />
              ))}
              {sold.length > 0 && (
                <tr>
                  <td colSpan={9} className="bg-gray-50 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                    Sold
                  </td>
                </tr>
              )}
              {sold.map(({ h, r }) => (
                <HoldingRowView key={h.id} h={h} r={r} open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} today={today} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HoldingRowView({
  h,
  r,
  open,
  onToggle,
  today,
  onChanged,
}: {
  h: HoldingJson;
  r: HoldingRow | undefined;
  open: boolean;
  onToggle: () => void;
  today: string;
  onChanged: () => void;
}) {
  const c = h.currency;
  const term = (() => {
    if (!r || r.closed || r.value === null) return null;
    if (r.nextLongTerm) {
      return r.longTermGain && Math.abs(r.longTermGain) > 0.005 ? `Mixed · rest LT in ${r.nextLongTerm.days}d` : `ST · LT in ${r.nextLongTerm.days}d`;
    }
    return r.shortTermGain && Math.abs(r.shortTermGain) > 0.005 ? "Short-term" : "Long-term";
  })();
  return (
    <Fragment>
      <tr className="cursor-pointer border-b hover:bg-gray-50" onClick={onToggle}>
        <td className="p-3">
          {/* Mutual funds go by name; their scheme code means little. */}
          <div className="max-w-[260px] truncate font-medium">{h.exchange === "AMFI" && h.name ? h.name : h.symbol}</div>
          <div className="max-w-[260px] truncate text-xs text-gray-500">
            {[h.exchange === "AMFI" && h.name ? `Scheme ${h.symbol}` : h.name, ASSET_TYPE_LABELS[h.assetType], h.sector].filter(Boolean).join(" · ")}
          </div>
        </td>
        {r?.closed ? (
          <>
            <td colSpan={4} className="p-3 text-right text-xs text-gray-500">
              All sold
            </td>
            <td className={`p-3 text-right ${tone(r.realizedGain)}`}>{fmtMoney(c, r.realizedGain)}</td>
            <td className="p-3 text-xs text-gray-500">realized</td>
            <td />
            <td />
          </>
        ) : (
          <>
            <td className="p-3 text-right tabular-nums">{r ? qtyText(r.quantity) : "—"}</td>
            <td className="p-3 text-right tabular-nums">{r ? fmtMoney(c, r.avgCost, priceDigits(r.avgCost)) : "—"}</td>
            <td className="p-3 text-right tabular-nums">
              {h.lastPrice !== null ? fmtMoney(c, h.lastPrice, priceDigits(h.lastPrice)) : <span className="text-xs text-amber-700">no price</span>}
              {h.lastPrice !== null && <div className="text-[10px] uppercase text-gray-400">{h.priceSource === "MANUAL" ? "typed in" : "live"}</div>}
            </td>
            <td className="p-3 text-right tabular-nums">{r?.value !== null && r ? fmtMoney(c, r.value) : "—"}</td>
            <td className={`p-3 text-right tabular-nums ${tone(r?.gain ?? null)}`}>
              {r?.gain !== null && r ? (
                <>
                  {fmtMoney(c, r.gain)}
                  <div className="text-xs">{pctText(r.gainPct)}</div>
                </>
              ) : (
                "—"
              )}
            </td>
            <td className="p-3 text-xs text-gray-600">{term ?? "—"}</td>
            <td className="p-3 text-right tabular-nums text-gray-600">{r ? `${Math.round(r.weight * 100)}%` : "—"}</td>
            <td className={`p-3 text-right tabular-nums ${tone(r?.xirr ?? null)}`}>{r?.xirr != null ? pctText(r.xirr) : "—"}</td>
          </>
        )}
      </tr>
      {open && (
        <tr className="border-b bg-gray-50">
          <td colSpan={9} className="p-3">
            <HoldingDetail h={h} r={r} today={today} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function HoldingDetail({ h, r, today, onChanged }: { h: HoldingJson; r: HoldingRow | undefined; today: string; onChanged: () => void }) {
  const [type, setType] = useState<"BUY" | "SELL" | "DIVIDEND">("BUY");
  const [form, setForm] = useState({ date: today, quantity: "", price: "", fees: "", amount: "" });
  const [price, setPrice] = useState("");
  const [sector, setSector] = useState(h.sector ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = h.currency;

  async function addTrade(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const n = (v: string) => (v.trim() ? Number(v) : null);
    const { ok, json } = await send(`/api/investments/holdings/${h.id}/trades`, "POST", {
      type,
      date: form.date,
      quantity: type === "DIVIDEND" ? null : n(form.quantity),
      price: type === "DIVIDEND" ? null : n(form.price),
      fees: n(form.fees),
      amount: type === "DIVIDEND" ? n(form.amount) : null,
    });
    setBusy(false);
    if (!ok) return setError(errorText(json, "Couldn't save that."));
    setForm({ date: today, quantity: "", price: "", fees: "", amount: "" });
    onChanged();
  }

  async function deleteTrade(id: string) {
    if (!confirm("Delete this entry?")) return;
    await send(`/api/investments/trades/${id}`, "DELETE");
    onChanged();
  }

  async function saveHolding(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { sector: sector.trim() || null };
    if (price.trim()) body.price = Number(price);
    const { ok, json } = await send(`/api/investments/holdings/${h.id}`, "PATCH", body);
    if (!ok) return setError(errorText(json, "Couldn't save."));
    setPrice("");
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete ${h.symbol} and all its buys, sales and dividends?`)) return;
    await send(`/api/investments/holdings/${h.id}`, "DELETE");
    onChanged();
  }

  return (
    <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
      {r && !r.closed && r.value !== null && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
          {r.longTermGain !== null && (
            <span>
              Long-term gain <span className={tone(r.longTermGain)}>{fmtMoney(c, r.longTermGain)}</span>
            </span>
          )}
          {r.shortTermGain !== null && (
            <span>
              Short-term gain <span className={tone(r.shortTermGain)}>{fmtMoney(c, r.shortTermGain)}</span>
            </span>
          )}
          {r.nextLongTerm && (
            <span>
              {qtyText(r.nextLongTerm.quantity)} turn long-term on {formatDate(r.nextLongTerm.date)}
            </span>
          )}
          {r.realizedGain !== 0 && (
            <span>
              Sold gains <span className={tone(r.realizedGain)}>{fmtMoney(c, r.realizedGain)}</span>
            </span>
          )}
          {r.dividends > 0 && <span>Dividends {fmtMoney(c, r.dividends)}</span>}
          {h.lastPriceAt && <span className="text-gray-400">Price as of {new Date(h.lastPriceAt).toLocaleString()}</span>}
        </div>
      )}

      <table className="w-full max-w-2xl text-sm">
        <tbody>
          {[...h.trades].reverse().map((t) => (
            <tr key={t.id} className="border-b last:border-0">
              <td className="py-1 pr-3 text-gray-500">{formatDate(t.date)}</td>
              <td className="py-1 pr-3 font-medium">{t.type === "BUY" ? "Bought" : t.type === "SELL" ? "Sold" : "Dividend"}</td>
              <td className="py-1 pr-3 tabular-nums">
                {t.type === "DIVIDEND"
                  ? fmtMoney(c, t.amount ?? 0, 2)
                  : `${qtyText(t.quantity ?? 0)} × ${fmtMoney(c, t.price ?? 0, priceDigits(t.price ?? 0))}${t.fees ? ` + ${fmtMoney(c, t.fees, 2)} fees` : ""}`}
              </td>
              <td className="py-1 text-right">
                <button onClick={() => deleteTrade(t.id)} className="text-xs text-red-500 hover:underline">
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={addTrade} className="flex flex-wrap items-end gap-2">
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="rounded-md border px-2 py-1.5 text-sm" aria-label="Entry type">
          <option value="BUY">Add buy</option>
          <option value="SELL">Add sale</option>
          <option value="DIVIDEND">Add dividend</option>
        </select>
        <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-md border px-2 py-1.5 text-sm" aria-label="Date" />
        {type === "DIVIDEND" ? (
          <input type="number" step="any" min="0" required placeholder={`Amount (${c})`} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-32 rounded-md border px-2 py-1.5 text-sm" />
        ) : (
          <>
            <input type="number" step="any" min="0" required placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-28 rounded-md border px-2 py-1.5 text-sm" />
            <input type="number" step="any" min="0" required placeholder={`Price (${c})`} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-32 rounded-md border px-2 py-1.5 text-sm" />
            <input type="number" step="any" min="0" placeholder="Fees (optional)" value={form.fees} onChange={(e) => setForm({ ...form, fees: e.target.value })} className="w-32 rounded-md border px-2 py-1.5 text-sm" />
          </>
        )}
        <button type="submit" disabled={busy} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          Save
        </button>
      </form>

      <form onSubmit={saveHolding} className="flex flex-wrap items-end gap-2 border-t pt-3">
        <input list="sectors" placeholder="Sector" value={sector} onChange={(e) => setSector(e.target.value)} className="w-48 rounded-md border px-2 py-1.5 text-sm" aria-label="Sector" />
        <input type="number" step="any" min="0" placeholder={`Type a price (${c})`} value={price} onChange={(e) => setPrice(e.target.value)} className="w-40 rounded-md border px-2 py-1.5 text-sm" aria-label="Price" />
        <button type="submit" className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
          Update
        </button>
        <button type="button" onClick={remove} className="ml-auto text-xs text-red-500 hover:underline">
          Delete holding
        </button>
        <datalist id="sectors">
          {SECTORS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={onClose}>
      <div className="my-8 w-full max-w-xl rounded-lg bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-600" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function L({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block text-xs text-gray-500 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function AccountForm({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: account?.name ?? "",
    broker: account?.broker ?? "",
    country: account?.country ?? "IN",
    currency: account?.currency ?? "INR",
    kind: account?.kind ?? "DEMAT",
    owner: account?.owner ?? "",
    loginNote: account?.loginNote ?? "",
    notes: account?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { ok, json } = await send(account ? `/api/investments/accounts/${account.id}` : "/api/investments/accounts", account ? "PATCH" : "POST", {
      ...f,
      broker: f.broker || null,
      owner: f.owner || null,
      loginNote: f.loginNote || null,
      notes: f.notes || null,
    });
    if (!ok) return setError(errorText(json, "Couldn't save the account."));
    onSaved();
  }

  async function archive() {
    if (!account) return;
    await send(`/api/investments/accounts/${account.id}`, "PATCH", { archived: !account.archived });
    onSaved();
  }

  async function remove() {
    if (!account) return;
    if (!confirm(`Delete ${account.name} with all its holdings, buys, sales and dividends? Archive it instead to keep the history.`)) return;
    await send(`/api/investments/accounts/${account.id}`, "DELETE");
    onSaved();
  }

  return (
    <Modal title={account ? "Edit account" : "Add an investment account"} onClose={onClose}>
      <form onSubmit={save} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
        <L label="Name *">
          <input required {...bind("name")} className={input} placeholder="Zerodha (Rajesh), Robinhood..." />
        </L>
        <L label="Broker / platform">
          <input {...bind("broker")} className={input} placeholder="Zerodha, Groww, Fidelity..." />
        </L>
        <L label="Country">
          <select
            value={f.country}
            onChange={(e) => {
              const country = e.target.value;
              setF({ ...f, country, currency: country === "IN" ? "INR" : country === "US" ? "USD" : f.currency, kind: country === "US" && f.kind === "DEMAT" ? "BROKERAGE" : f.kind });
            }}
            className={input}
          >
            <option value="IN">India</option>
            <option value="US">USA</option>
            <option value="OTHER">Other</option>
          </select>
        </L>
        <L label="Currency">
          <select {...bind("currency")} className={input}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </L>
        <L label="Kind">
          <select {...bind("kind")} className={input}>
            {ACCOUNT_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </L>
        <L label="Whose account">
          <input {...bind("owner")} className={input} />
        </L>
        <L label="Login (where it's kept, user ID — no password)" wide>
          <input {...bind("loginNote")} className={input} placeholder="Bitwarden → 'Zerodha', client ID AB1234" />
        </L>
        <L label="Notes" wide>
          <textarea {...bind("notes")} rows={2} className={input} />
        </L>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex items-center justify-between sm:col-span-2">
          {account ? (
            <span className="flex gap-3">
              <button type="button" onClick={archive} className="text-sm text-gray-500 hover:underline">
                {account.archived ? "Unarchive" : "Archive"}
              </button>
              <button type="button" onClick={remove} className="text-sm text-red-500 hover:underline">
                Delete
              </button>
            </span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function HoldingForm({
  accounts,
  accountId,
  today,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  accountId: string | null;
  today: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const first = accounts.find((x) => x.id === accountId) ?? accounts[0];
  const defaults = (acc: Account) => ({
    exchange: acc.kind === "CRYPTO" ? "CRYPTO" : acc.kind === "MUTUAL_FUND" ? "AMFI" : acc.country === "IN" ? "NSE" : acc.country === "US" ? "US" : "OTHER",
    assetType: acc.kind === "CRYPTO" ? "CRYPTO" : acc.kind === "MUTUAL_FUND" ? "MUTUAL_FUND" : "STOCK",
  });
  const [f, setF] = useState({
    accountId: first?.id ?? "",
    symbol: "",
    name: "",
    sector: "",
    ...defaults(first),
    date: today,
    quantity: "",
    price: "",
    fees: "",
    currentPrice: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const account = accounts.find((x) => x.id === f.accountId);
  const c = account?.currency ?? "USD";
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });
  const symbolHint: Record<string, string> = {
    NSE: "e.g. RELIANCE, TCS, NIFTYBEES",
    BSE: "e.g. 500325 or RELIANCE",
    US: "e.g. AAPL, VOO, BRK.B",
    AMFI: "AMFI scheme code (e.g. 120503) or ISIN",
    CRYPTO: "e.g. BTC, ETH",
    OTHER: "any name; type its price below",
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const n = (v: string) => (v.trim() ? Number(v) : null);
    const { ok, json } = await send("/api/investments/holdings", "POST", {
      accountId: f.accountId,
      symbol: f.symbol,
      name: f.name || null,
      exchange: f.exchange,
      assetType: f.assetType,
      sector: f.sector || (f.assetType === "CRYPTO" ? "Crypto" : f.assetType === "ETF" || f.assetType === "MUTUAL_FUND" ? "Index / Diversified" : null),
      price: n(f.currentPrice),
      firstTrade: f.quantity ? { type: "BUY", date: f.date, quantity: n(f.quantity), price: n(f.price) ?? 0, fees: n(f.fees) } : undefined,
    });
    setSaving(false);
    if (!ok) return setError(errorText(json, "Couldn't add the holding."));
    onSaved(json.id);
  }

  return (
    <Modal title="Add a holding" onClose={onClose}>
      <form onSubmit={save} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
        <L label="Account">
          <select
            value={f.accountId}
            onChange={(e) => {
              const acc = accounts.find((x) => x.id === e.target.value)!;
              setF({ ...f, accountId: acc.id, ...defaults(acc) });
            }}
            className={input}
          >
            {accounts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({COUNTRY_LABELS[x.country]}, {x.currency})
              </option>
            ))}
          </select>
        </L>
        <L label="Where it trades">
          <select {...bind("exchange")} className={input}>
            {EXCHANGES.map((x) => (
              <option key={x} value={x}>
                {EXCHANGE_LABELS[x]}
              </option>
            ))}
          </select>
        </L>
        <L label="Symbol *">
          <input required {...bind("symbol")} className={input} placeholder={symbolHint[f.exchange]} />
        </L>
        <L label="Name">
          <input {...bind("name")} className={input} placeholder="Reliance Industries" />
        </L>
        <L label="Type">
          <select {...bind("assetType")} className={input}>
            {ASSET_TYPES.map((x) => (
              <option key={x} value={x}>
                {ASSET_TYPE_LABELS[x]}
              </option>
            ))}
          </select>
        </L>
        <L label="Sector">
          <input list="sectors-new" {...bind("sector")} className={input} placeholder="Banking, Technology..." />
          <datalist id="sectors-new">
            {SECTORS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </L>
        <p className="pt-1 text-sm font-semibold text-gray-700 sm:col-span-2">First buy</p>
        <L label="Date bought">
          <input type="date" {...bind("date")} className={input} />
        </L>
        <L label="Quantity">
          <input type="number" step="any" min="0" {...bind("quantity")} className={input} />
        </L>
        <L label={`Price per unit (${c})`}>
          <input type="number" step="any" min="0" required={!!f.quantity} {...bind("price")} className={input} />
        </L>
        <L label={`Fees (${c}, optional)`}>
          <input type="number" step="any" min="0" {...bind("fees")} className={input} />
        </L>
        <p className="text-xs text-gray-400 sm:col-span-2">
          Bought at different times? Add the first buy here, then the others from the holding&apos;s row. Not sure of old dates? Use your
          average price and an approximate date: it only affects the long-term/short-term split.
        </p>
        {f.exchange === "OTHER" && (
          <L label={`Current price (${c})`} wide>
            <input type="number" step="any" min="0" {...bind("currentPrice")} className={input} />
          </L>
        )}
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </button>
          <button type="submit" disabled={saving || !f.accountId} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? "Saving..." : "Add holding"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
