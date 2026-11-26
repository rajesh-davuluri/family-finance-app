"use client";

// Pieces shared by the Investments page's sections: the data shapes the
// page reads from /api/investments, formatting helpers, and the modal and
// form-label wrappers.

import type { Trade } from "@/lib/investments";

export type TradeJson = Trade & { id: string; notes: string | null };
export type HoldingJson = {
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
export type Account = {
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
export type Fx = { USDINR: number; updatedAt: string | null; live: boolean };

export const input = "w-full rounded-md border px-3 py-2 text-sm";
export const SECTORS = [
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

export const pctText = (n: number | null, digits = 1) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`);
export const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, ""));
export const tone = (n: number | null) => (n === null ? "" : n >= 0 ? "text-income-600" : "text-expense-600");
export const priceDigits = (n: number) => (n < 10 ? 4 : 2);

export function errorText(body: { error?: unknown }, fallback: string) {
  if (typeof body.error === "string") return body.error;
  const e = body.error as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
  const first = e?.fieldErrors && Object.entries(e.fieldErrors)[0];
  return first ? `${first[0]}: ${first[1][0]}` : (e?.formErrors?.[0] ?? fallback);
}

export async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

export function L({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block text-xs text-gray-500 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

