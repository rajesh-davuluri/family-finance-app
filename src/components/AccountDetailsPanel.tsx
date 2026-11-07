"use client";

import { useEffect, useState } from "react";

// An account's reference details on the Instruments page: bank, branch,
// IFSC/routing number, account number (stored encrypted, masked until
// "Show"), customer ID, nominee, phone, website and where the login is
// kept. No passwords.

type Details = {
  bankName: string | null;
  branch: string | null;
  routingCode: string | null;
  accountNumberLast4: string | null;
  hasAccountNumber: boolean;
  accountNumber: string | null;
  accountHolder: string | null;
  customerId: string | null;
  nominee: string | null;
  phone: string | null;
  website: string | null;
  loginNote: string | null;
  notes: string | null;
};

type Editable = Omit<Details, "accountNumberLast4" | "hasAccountNumber" | "accountNumber">;
const KEYS: (keyof Editable)[] = [
  "bankName",
  "branch",
  "routingCode",
  "accountHolder",
  "customerId",
  "nominee",
  "phone",
  "website",
  "loginNote",
  "notes",
];

const input = "w-full rounded-md border px-3 py-2 text-sm";
const url = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);

export default function AccountDetailsPanel({ instrumentId, currency, type }: { instrumentId: string; currency: string; type: string }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<keyof Editable, string>>({} as Record<keyof Editable, string>);
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [accountNumberTouched, setAccountNumberTouched] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const routingLabel = currency === "INR" ? "IFSC code" : currency === "USD" ? "Routing number" : "Bank / sort code";
  const numberLabel = type === "CREDIT_CARD" ? "Card number" : "Account number";

  useEffect(() => {
    // Ignore a response that arrives after this panel moved on (or after
    // React re-ran the effect), so it can't wipe what's being typed.
    let current = true;
    fetch(`/api/instruments/${instrumentId}/details`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Details | null) => {
        if (!current) return;
        setDetails(d);
        setLoading(false);
        if (!d) startEditing(null);
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentId]);

  function startEditing(d: Details | null) {
    setForm(Object.fromEntries(KEYS.map((k) => [k, d?.[k] ?? ""])) as Record<keyof Editable, string>);
    setAccountNumber("");
    setAccountNumberTouched(false);
    setError(null);
    setEditing(true);
  }

  async function reveal() {
    if (revealed) return setRevealed(null);
    const r = await fetch(`/api/instruments/${instrumentId}/details?reveal=1`);
    const d: Details | null = r.ok ? await r.json() : null;
    setRevealed(d?.accountNumber ?? null);
    if (d?.accountNumber) setTimeout(() => setRevealed(null), 30_000);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, string | null> = Object.fromEntries(KEYS.map((k) => [k, form[k].trim() || null]));
    if (accountNumberTouched) body.accountNumber = accountNumber.trim() || null;
    const r = await fetch(`/api/instruments/${instrumentId}/details`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(typeof json.error === "string" ? json.error : "Couldn't save the details.");
    setDetails(json);
    setRevealed(null);
    setEditing(false);
  }

  if (loading) return <p className="p-3 text-xs text-gray-400">Loading details...</p>;

  if (editing) {
    const f = (k: keyof Editable, label: string, placeholder?: string, wide?: boolean) => (
      <label className={`block text-xs text-gray-500 ${wide ? "sm:col-span-3" : ""}`}>
        {label}
        <input
          value={form[k]}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          placeholder={placeholder}
          className={`${input} mt-1`}
        />
      </label>
    );
    return (
      <form onSubmit={save} className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-3">
        {f("bankName", "Bank", currency === "INR" ? "HDFC Bank" : "Bank of America")}
        {f("branch", "Branch")}
        {f("routingCode", routingLabel)}
        <label className="block text-xs text-gray-500">
          {numberLabel} {details?.hasAccountNumber && !accountNumberTouched && <span>(saved, ending {details.accountNumberLast4})</span>}
          <input
            value={accountNumber}
            onChange={(e) => {
              setAccountNumber(e.target.value);
              setAccountNumberTouched(true);
            }}
            placeholder={details?.hasAccountNumber ? "Leave blank to keep it" : "Stored encrypted"}
            autoComplete="off"
            className={`${input} mt-1`}
          />
          {details?.hasAccountNumber && (
            <button
              type="button"
              onClick={() => {
                setAccountNumber("");
                setAccountNumberTouched(true);
              }}
              className="mt-1 text-xs text-red-500 hover:underline"
            >
              Remove saved number
            </button>
          )}
        </label>
        {f("accountHolder", "Account holder")}
        {f("customerId", "Customer ID / CRN")}
        {f("nominee", "Nominee")}
        {f("phone", "Customer care")}
        {f("website", "Net banking website", currency === "INR" ? "netbanking.hdfcbank.com" : "bankofamerica.com")}
        {f("loginNote", "Login (where it's kept, user ID — no password)", "Bitwarden → 'HDFC NetBanking'", true)}
        <label className="block text-xs text-gray-500 sm:col-span-3">
          Notes
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={`${input} mt-1`} />
        </label>
        {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-3">
          {details && (
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border px-3 py-1.5 text-sm">
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save details"}
          </button>
        </div>
      </form>
    );
  }

  const d = details!;
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex gap-2 py-0.5 text-sm">
        <dt className="w-40 shrink-0 text-gray-500">{label}</dt>
        <dd className="min-w-0 break-words">{value}</dd>
      </div>
    ) : null;
  return (
    <div className="p-3">
      <dl className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
        {row("Bank", d.bankName)}
        {row("Branch", d.branch)}
        {row(routingLabel, d.routingCode)}
        {row(
          numberLabel,
          d.hasAccountNumber && (
            <span>
              <span className="font-mono">{revealed ?? `•••• ${d.accountNumberLast4 ?? ""}`}</span>
              <button onClick={reveal} className="ml-2 text-xs text-brand-600 hover:underline">
                {revealed ? "Hide" : "Show"}
              </button>
              {revealed && (
                <button onClick={() => navigator.clipboard?.writeText(revealed)} className="ml-2 text-xs text-brand-600 hover:underline">
                  Copy
                </button>
              )}
            </span>
          ),
        )}
        {row("Account holder", d.accountHolder)}
        {row("Customer ID", d.customerId)}
        {row("Nominee", d.nominee)}
        {row(
          "Customer care",
          d.phone && (
            <a href={`tel:${d.phone}`} className="text-brand-600 hover:underline">
              {d.phone}
            </a>
          ),
        )}
        {row(
          "Website",
          d.website && (
            <a href={url(d.website)} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
              {d.website}
            </a>
          ),
        )}
        {row("Login", d.loginNote)}
      </dl>
      {d.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{d.notes}</p>}
      <button onClick={() => startEditing(d)} className="mt-2 text-xs text-brand-600 hover:underline">
        Edit details
      </button>
    </div>
  );
}
