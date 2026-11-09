"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/formatDate";
import type { TransferView } from "@/lib/remittances";

// Money sent to India: every transfer of the year, the rupees that arrived,
// the rate got against the market's that day, and what the difference cost.

type Summary = {
  count: number;
  usd: number;
  inr: number;
  inrEstimated: boolean;
  yourAvgRate: number | null;
  marketAvgRate: number | null;
  costUsd: number;
  receiptsMissing: number;
  services: { name: string; count: number; usd: number; rate: number | null }[];
};
type Data = { year: number; years: number[]; marketAvailable: boolean; latestRate: number | null; transfers: TransferView[]; summary: Summary };

const inr = (n: number) => money(n, "INR", 0);
const rate = (n: number | null) => (n == null ? "—" : `₹${n.toFixed(2)}`);

export default function RemittancesPage() {
  const [year, setYear] = useState<number | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/remittances${year ? `?year=${year}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [year]);
  useEffect(load, [load]);

  if (!data) return <p className="text-sm text-gray-400">Loading...</p>;
  const s = data.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Money to India</h1>
          <p className="text-sm text-gray-500">Every transfer, the rupees that arrived, and the rate you got against the market&apos;s that day.</p>
        </div>
        {data.years.length > 1 && (
          <select value={data.year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-md border px-3 py-2 text-sm" aria-label="Year">
            {data.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
      </div>

      {s.count === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
          No transfers to India in {data.year}. They&apos;re found from your bank transactions (Crobo, Remitly, Wise and others, or the &ldquo;Transfer to
          India&rdquo; category).
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={`Sent in ${data.year}`} value={money(s.usd, "USD")} sub={`${s.count} transfer${s.count === 1 ? "" : "s"}`} dark />
            <Tile
              label="Arrived"
              value={inr(s.inr)}
              sub={
                s.inrEstimated
                  ? `${s.receiptsMissing} estimated at the market rate`
                  : s.receiptsMissing
                    ? `${s.receiptsMissing} transfer${s.receiptsMissing === 1 ? "" : "s"} not entered yet`
                    : "from your receipts"
              }
            />
            <Tile
              label="Your average rate"
              value={rate(s.yourAvgRate)}
              sub={s.marketAvgRate != null ? `market ${rate(s.marketAvgRate)} on those days` : s.yourAvgRate == null ? "enter what arrived" : "market rate unavailable"}
            />
            <Tile
              label="Rate cost vs market"
              value={s.marketAvgRate == null ? "—" : money(s.costUsd, "USD")}
              sub={
                s.yourAvgRate == null ? "enter what arrived to see this" : s.marketAvgRate == null ? "market rate unavailable" : "what you'd have kept at the market rate"
              }
              warn={s.marketAvgRate != null && s.costUsd > 0}
            />
          </section>

          {s.receiptsMissing > 0 && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              {s.receiptsMissing} transfer{s.receiptsMissing === 1 ? " is" : "s are"} missing the rupees that arrived — tap <b>Enter ₹</b> and type it from the
              Crobo app or the HDFC credit SMS to see the real rate.
            </p>
          )}

          {s.services.length > 1 && (
            <section className="rounded-xl border bg-white p-4">
              <h2 className="mb-2 text-sm font-medium text-gray-700">By service</h2>
              <ul className="divide-y text-sm">
                {s.services.map((v) => (
                  <li key={v.name} className="flex justify-between gap-3 py-2">
                    <span>
                      {v.name} <span className="text-xs text-gray-400">{v.count} transfers</span>
                    </span>
                    <span className="tabular-nums">
                      {money(v.usd, "USD", 0)} · {rate(v.rate)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border bg-white">
            <ul className="divide-y">
              {data.transfers.map((t) => (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {money(t.usd, "USD")} <span className="font-normal text-gray-400">→</span>{" "}
                        <span className={t.estimated ? "text-gray-400" : ""}>
                          {t.inr != null ? inr(t.inr) : "₹ ?"}
                          {t.estimated && t.inr != null && <span className="text-xs"> est.</span>}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(t.date, { month: "short", day: "numeric", year: "numeric" })} · {t.service}
                        {t.feeUsd ? ` · fee ${money(t.feeUsd, "USD")}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <p className="tabular-nums">
                        {t.yourRate != null ? rate(t.yourRate) : <span className="text-gray-400">—</span>}
                        <span className="text-xs text-gray-400"> you</span>
                      </p>
                      <p className="tabular-nums text-xs text-gray-500">{rate(t.marketRate)} market</p>
                      {t.costUsd != null && (
                        <p className={`text-xs tabular-nums ${t.costUsd > 0.5 ? "text-expense-600" : "text-income-600"}`}>
                          {t.costUsd > 0.5 ? `cost ${money(t.costUsd, "USD")}` : t.costUsd < -0.5 ? `beat market by ${money(-t.costUsd, "USD")}` : "at market"}
                        </p>
                      )}
                    </div>
                  </div>
                  {editing === t.id ? (
                    <ReceivedForm
                      t={t}
                      onDone={() => {
                        setEditing(null);
                        load();
                      }}
                    />
                  ) : (
                    <button onClick={() => setEditing(t.id)} className="mt-1.5 text-sm text-brand-700 underline">
                      {t.estimated ? "Enter ₹ received" : "Edit ₹ received"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-gray-400">
            Market rate: the day&apos;s USD→INR close (Yahoo Finance){data.latestRate ? `; today about ${rate(data.latestRate)}` : ""}.
            {!data.marketAvailable && " It couldn't be fetched just now — try again later."} &ldquo;Rate cost&rdquo; is the dollars sent minus what the
            rupees received would have cost at the market rate — the service&apos;s margin plus any fee.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, dark, warn }: { label: string; value: string; sub?: string; dark?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${dark ? "bg-ink-900 text-white" : "bg-white"}`}>
      <p className={`text-xs uppercase tracking-wide ${dark ? "text-ink-300" : "text-gray-500"}`}>{label}</p>
      <p className={`font-display mt-1 text-2xl tabular-nums ${warn ? "text-expense-600" : ""}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${dark ? "text-ink-300" : "text-gray-500"}`}>{sub}</p>}
    </div>
  );
}

function ReceivedForm({ t, onDone }: { t: TransferView; onDone: () => void }) {
  const [amount, setAmount] = useState(t.estimated ? "" : String(t.inr ?? ""));
  const [fee, setFee] = useState(t.feeUsd ? String(t.feeUsd) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (s: string) => Number(s.replace(/[,₹$\s]/g, ""));

  async function save(remove = false) {
    const v = num(amount);
    if (!remove && (!amount.trim() || !Number.isFinite(v) || v <= 0)) return setErr("Enter the rupees that arrived.");
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/remittances/${t.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inrReceived: remove ? null : v, feeUsd: fee.trim() ? num(fee) : null }),
    });
    setBusy(false);
    if (!res.ok) return setErr((await res.json().catch(() => null))?.error ?? "Couldn't save.");
    onDone();
  }

  const preview = num(amount) > 0 ? num(amount) / t.usd : null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
      <label>
        <span className="mb-1 block text-xs text-gray-500">₹ that arrived</span>
        <input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t.inr ? String(Math.round(t.inr)) : "0"} className="w-full rounded-md border px-3 py-2" />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-500">Fee ($, optional)</span>
        <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" className="w-full rounded-md border px-3 py-2" />
      </label>
      {preview && <p className="col-span-2 text-xs text-gray-500">That&apos;s ₹{preview.toFixed(2)} per dollar.</p>}
      {err && <p className="col-span-2 text-red-600">{err}</p>}
      <div className="col-span-2 flex gap-2">
        <button onClick={() => save()} disabled={busy} className="flex-1 rounded-md bg-brand-600 px-4 py-2 font-medium text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        {!t.estimated && (
          <button onClick={() => save(true)} disabled={busy} className="rounded-md border px-3 py-2 text-red-600">
            Remove
          </button>
        )}
        <button onClick={onDone} className="rounded-md border px-3 py-2 text-gray-600">
          Cancel
        </button>
      </div>
    </div>
  );
}
