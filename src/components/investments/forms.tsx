"use client";

// Forms on the Investments page: adding or editing an account, adding a
// holding, and a holding's detail (its trades, add a buy/sale/dividend,
// sector and typed-in price).

import { useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import { formatDate } from "@/lib/formatDate";
import {
  ACCOUNT_KINDS,
  ACCOUNT_KIND_LABELS,
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  COUNTRY_LABELS,
  EXCHANGES,
  EXCHANGE_LABELS,
  fmtMoney,
  type HoldingRow,
} from "@/lib/investments";
import { L, Modal, SECTORS, errorText, input, priceDigits, qtyText, send, tone, type Account, type HoldingJson } from "./shared";

export function HoldingDetail({ h, r, today, onChanged }: { h: HoldingJson; r: HoldingRow | undefined; today: string; onChanged: () => void }) {
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


export function AccountForm({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
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

export function HoldingForm({
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

