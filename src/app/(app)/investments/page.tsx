"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getTodayLocal } from "@/lib/formatDate";
import {
  analyze,
  crossBorderChecklist,
  fmtMoney,
  healthCheck,
  isApproxNote,
  toUsd,
  trackRecord,
  type HoldingInput,
} from "@/lib/investments";
import { AccountForm, HoldingForm } from "@/components/investments/forms";
import { Overview } from "@/components/investments/overview";
import { HoldingsTab } from "@/components/investments/holdings";
import { PerformanceTab } from "@/components/investments/performance";
import { TaxTab } from "@/components/investments/tax";
import { AccountsTab } from "@/components/investments/accounts";
import { send, type Account, type Fx } from "@/components/investments/shared";

// Investments: stocks, ETFs, mutual funds and crypto in India and the US,
// laid out as an analyst reads a portfolio -- Overview (value, split, health,
// what stands out), Holdings, Performance (vs an index, winners/losers,
// track record), Tax, and Accounts. Every number comes from the recorded
// trades and the latest prices (src/lib/investments.ts).

const TABS = [
  ["overview", "Overview"],
  ["holdings", "Holdings"],
  ["performance", "Performance"],
  ["tax", "Tax"],
  ["accounts", "Accounts"],
] as const;
type Tab = (typeof TABS)[number][0];

type Bank = { currency: string; type: string; archived: boolean; currentBalance: number | null };

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export default function InvestmentsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fx, setFx] = useState<Fx>({ USDINR: 94.3, updatedAt: null, live: false });
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [ccy, setCcy] = useState<"USD" | "INR">("USD");
  const [editingAccount, setEditingAccount] = useState<Account | "new" | null>(null);
  const [addingHolding, setAddingHolding] = useState<string | true | null>(null);
  const today = getTodayLocal();

  const load = useCallback(async () => {
    const [res, inst] = await Promise.all([fetch("/api/investments"), fetch("/api/instruments")]);
    if (inst.ok) setBanks(await inst.json());
    if (res.ok) {
      const body = await res.json();
      setAccounts(body.accounts);
      setFx(body.fx);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Tab from the address (#holdings), and the viewer's preferred currency.
    const fromHash = window.location.hash.slice(1);
    if (TABS.some(([k]) => k === fromHash)) setTab(fromHash as Tab);
    try {
      const saved = localStorage.getItem("investments.currency");
      if (saved === "USD" || saved === "INR") setCcy(saved);
    } catch {
      /* storage unavailable: default USD */
    }
  }, [load]);

  function openTab(t: string) {
    setTab(t as Tab);
    history.replaceState(null, "", `#${t}`);
    window.scrollTo({ top: 0 });
  }

  function chooseCurrency(c: "USD" | "INR") {
    setCcy(c);
    try {
      localStorage.setItem("investments.currency", c);
    } catch {
      /* fine without it */
    }
  }

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
            trades: h.trades.map((t) => ({ ...t, approx: isApproxNote(t.notes) })),
            taxDeferred: a.kind === "RETIREMENT",
          })),
        ),
    [accounts],
  );
  const a = useMemo(() => analyze(inputs, fx, today), [inputs, fx, today]);
  const health = useMemo(() => healthCheck(a, today), [a, today]);
  const records = useMemo(() => trackRecord(a.rows, today), [a, today]);
  const rowOf = useMemo(() => new Map(a.rows.map((r) => [r.id, r])), [a]);

  const india = a.rows.filter((r) => r.country === "IN" && !r.closed);
  const usAccounts = banks.some((b) => !b.archived && b.currency === "USD") || a.rows.some((r) => r.country === "US");
  const inrBanks = banks.filter((b) => !b.archived && b.currency === "INR" && b.type !== "CREDIT_CARD");
  const indiaBankUsd = inrBanks.some((b) => b.currentBalance !== null)
    ? inrBanks.reduce((x, b) => x + toUsd(Math.max(0, b.currentBalance ?? 0), "INR", fx), 0)
    : null;
  const checklist = india.length && usAccounts ? crossBorderChecklist(india.reduce((x, r) => x + r.valueUsd, 0), indiaBankUsd) : [];

  const money = (usd: number) => (ccy === "INR" ? fmtMoney("INR", usd * fx.USDINR) : fmtMoney("USD", usd));
  const altMoney = (usd: number) => (ccy === "INR" ? fmtMoney("USD", usd) : fmtMoney("INR", usd * fx.USDINR));
  const live = accounts.flatMap((x) => x.holdings).filter((h) => h.priceSource === "LIVE" && h.lastPriceAt).map((h) => h.lastPriceAt!).sort().pop();
  const openAccounts = accounts.filter((x) => !x.archived);
  const hasHoldings = inputs.length > 0;

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Investments</h1>
          <p className="text-sm text-gray-500">
            {hasHoldings ? (
              <>
                Prices {live ? `refreshed ${ago(live)}` : "typed in, not refreshed yet"} · $1 = ₹{fx.USDINR.toFixed(2)}
                {fx.live ? "" : " (approximate)"}
              </>
            ) : (
              "Stocks, ETFs, mutual funds and crypto in India and the US."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasHoldings && (
            <div role="radiogroup" aria-label="Show amounts in" className="inline-flex rounded-md border bg-white p-0.5 text-xs">
              {(["USD", "INR"] as const).map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={ccy === c}
                  onClick={() => chooseCurrency(c)}
                  className={`rounded px-2.5 py-1 ${ccy === c ? "bg-ink-900 font-medium text-white" : "text-gray-600 hover:text-ink-900"}`}
                >
                  {c === "USD" ? "$ USD" : "₹ INR"}
                </button>
              ))}
            </div>
          )}
          {hasHoldings && (
            <button onClick={refreshPrices} disabled={refreshing} className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50">
              {refreshing ? "Refreshing..." : "Refresh prices"}
            </button>
          )}
          {openAccounts.length > 0 ? (
            <button onClick={() => setAddingHolding(true)} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              Add holding
            </button>
          ) : (
            <button onClick={() => setEditingAccount("new")} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              Add account
            </button>
          )}
        </div>
      </div>

      {message && <p className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">{message}</p>}

      {!hasHoldings ? (
        <div className="rounded-lg border bg-white p-6 text-sm text-gray-600">
          <p className="font-medium text-gray-800">Get started in three steps</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              <strong>Add an account</strong> for each place you invest: Zerodha or Groww (India), Robinhood or Fidelity (US), a 401(k), a crypto
              exchange.
            </li>
            <li>
              <strong>Add your holdings</strong>: symbol (RELIANCE, AAPL), quantity, price and date of each buy. Dates matter for long-term vs
              short-term tax.
            </li>
            <li>
              <strong>Refresh prices</strong>: live from NSE/BSE, US exchanges, crypto and AMFI mutual fund NAVs.
            </li>
          </ol>
          {openAccounts.length > 0 && (
            <button onClick={() => openTab("accounts")} className="mt-3 text-sm text-brand-600 hover:underline">
              Your accounts →
            </button>
          )}
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Investments sections" className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => openTab(k)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                  tab === k ? "border-brand-500 font-medium text-ink-900" : "border-transparent text-gray-500 hover:text-ink-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <Overview
              a={a}
              health={health}
              money={money}
              altMoney={altMoney}
              holdingsCount={a.rows.filter((r) => !r.closed).length}
              accountsCount={new Set(a.rows.filter((r) => !r.closed).map((r) => r.accountId)).size}
              onOpenTab={openTab}
            />
          )}
          {tab === "holdings" && <HoldingsTab accounts={accounts} rowOf={rowOf} money={money} today={today} onChanged={load} />}
          {tab === "performance" && <PerformanceTab records={records} rows={a.rows} money={money} />}
          {tab === "tax" && <TaxTab a={a} checklist={checklist} />}
        </>
      )}
      {(tab === "accounts" || !hasHoldings) && accounts.length > 0 && (
        <AccountsTab
          accounts={accounts}
          rowOf={rowOf}
          onEdit={(acc) => setEditingAccount(acc)}
          onAddHolding={(id) => setAddingHolding(id)}
          onAddAccount={() => setEditingAccount("new")}
        />
      )}

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
          accounts={openAccounts}
          accountId={addingHolding === true ? null : addingHolding}
          today={today}
          onClose={() => setAddingHolding(null)}
          onSaved={() => {
            setAddingHolding(null);
            openTab("holdings");
            load();
          }}
        />
      )}
    </div>
  );
}
