"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/formatDate";

// Likely duplicates among saved transactions (last ~6 months), to review one
// pair at a time: remove the extra copy, or keep both ("not a duplicate" is
// remembered in this browser so the pair doesn't come back).

type Txn = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  notes: string | null;
  categoryName: string;
  instrumentName: string;
  source: string;
};
type Pair = {
  keep: string;
  remove: string;
  confidence: "HIGH" | "MEDIUM";
  daysApart: number;
  reason: string;
  keepTxn: Txn;
  removeTxn: Txn;
};

// Where "keep both" used to be remembered, in this browser only. Anything
// still here is moved to the household's record once, then cleared.
const DISMISSED_KEY = "ff.duplicates.dismissed";
const SOURCE_WORDS: Record<string, string> = {
  IMPORTED: "from statement",
  EMAIL: "from email",
  TELEGRAM: "from Telegram",
  RECURRING: "recurring",
  MANUAL: "added by hand",
};

const pairKey = (p: Pair) => [p.keep, p.remove].sort().join("|");

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export default function DuplicateReview({ refreshKey, onRemoved }: { refreshKey: number; onRemoved: () => void }) {
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = readDismissed();
      setDismissed(local);
      if (local.size) {
        const moved = await saveKeepBoth([...local].map((k) => k.split("|") as [string, string]));
        if (moved) {
          try {
            localStorage.removeItem(DISMISSED_KEY);
          } catch {
            /* private mode */
          }
        }
      }
      const b = await fetch("/api/transactions/duplicates")
        .then((r) => (r.ok ? r.json() : { pairs: [] }))
        .catch(() => ({ pairs: [] }));
      if (!cancelled) setPairs(b.pairs);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const visible = (pairs ?? []).filter((p) => !dismissed.has(pairKey(p)));
  if (visible.length === 0) return null;
  const likely = visible.filter((p) => p.confidence === "HIGH").length;

  // Remembered for the household, so the pair isn't asked about again on
  // any device.
  async function keepBoth(p: Pair) {
    setDismissed((d) => new Set(d).add(pairKey(p)));
    if (!(await saveKeepBoth([[p.keep, p.remove]]))) setError("Couldn't save that — it may be asked again.");
  }

  async function remove(p: Pair) {
    setError(null);
    setBusy(p.remove);
    const res = await fetch(`/api/transactions/${p.remove}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      setError("Couldn't remove that transaction — try again.");
      return;
    }
    setPairs((ps) => (ps ?? []).filter((x) => x.remove !== p.remove));
    onRemoved();
  }

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <strong>
            {visible.length} possible duplicate{visible.length === 1 ? "" : "s"}
          </strong>{" "}
          in the last 6 months{likely ? ` (${likely} likely)` : ""} — the same purchase recorded twice, e.g. typed in
          and also imported from the statement.
        </p>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs hover:bg-amber-100"
        >
          {open ? "Hide" : "Review"}
        </button>
      </div>
      {error && <p className="mt-2 text-red-700">{error}</p>}
      {open && (
        <ul className="mt-3 space-y-2">
          {visible.map((p) => (
            <li key={pairKey(p)} className="rounded-md border border-amber-200 bg-white p-3 text-gray-800">
              <p className="mb-2 text-xs text-amber-800">
                <span
                  className={`mr-1 rounded px-1.5 py-0.5 ${p.confidence === "HIGH" ? "bg-amber-200" : "bg-gray-100 text-gray-600"}`}
                >
                  {p.confidence === "HIGH" ? "Likely" : "Maybe"}
                </span>
                {p.reason}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <TxnCard t={p.keepTxn} label="Keep" />
                <TxnCard t={p.removeTxn} label="Extra copy" muted />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => remove(p)}
                  disabled={busy === p.remove}
                  className="rounded-md bg-expense-600 px-3 py-1 text-xs font-medium text-white hover:bg-expense-500 disabled:opacity-50"
                >
                  {busy === p.remove ? "Removing…" : "Remove extra copy"}
                </button>
                <button onClick={() => keepBoth(p)} className="rounded-md border px-3 py-1 text-xs hover:bg-gray-50">
                  Not a duplicate — keep both
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TxnCard({ t, label, muted }: { t: Txn; label: string; muted?: boolean }) {
  return (
    <div className={`rounded border p-2 ${muted ? "border-dashed" : ""}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium tabular-nums">
        {t.currency} {t.amount.toFixed(2)} · {formatDate(t.date, { month: "short", day: "numeric", year: "numeric" })}
      </p>
      <p className="text-xs text-gray-600">
        {t.notes || <span className="text-gray-400">no description</span>}
        <span className="block text-gray-400">
          {t.categoryName} · {t.instrumentName} · {SOURCE_WORDS[t.source] ?? t.source}
        </span>
      </p>
    </div>
  );
}

async function saveKeepBoth(pairs: [string, string][]): Promise<boolean> {
  const valid = pairs.filter(([a, b]) => a && b);
  if (!valid.length) return true;
  try {
    const res = await fetch("/api/transactions/duplicates/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs: valid.slice(0, 500).map(([a, b]) => ({ a, b })) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
