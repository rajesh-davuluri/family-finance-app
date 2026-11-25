"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/money";
import { CUTS, limitWithCut } from "@/lib/budgets";

// Suggested budgets: each everyday spending category at its typical month
// over the last six (src/lib/budgets.ts), or a chosen share less to spend
// less. Tick, adjust and save in one go.

type Suggestion = {
  categoryId: string;
  name: string;
  typical: number;
  average: number;
  highest: number;
  suggested: number;
  monthsWithSpend: number;
  currentLimit: number | null;
};

const usd = (n: number) => money(n, "USD", 0);

export default function SmartBudgets({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<{ monthsUsed: number; suggestions: Suggestion[] } | null>(null);
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // How much less than usual to aim for (0.25 = 25% less).
  const [cut, setCut] = useState<number>(0.25);

  const load = () =>
    fetch("/api/budgets/suggestions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setData(j);
        // Ticked: categories without a budget yet.
        setPicked(new Map((j?.suggestions ?? []).filter((s: Suggestion) => s.currentLimit == null).map((s: Suggestion) => [s.categoryId, String(limitWithCut(s.typical, cut))])));
      })
      .catch(() => setData(null));
  useEffect(() => {
    load();
    // Once, when the page opens; a later aim is applied by chooseCut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data || data.suggestions.length === 0) return null;
  const fresh = data.suggestions.filter((s) => s.currentLimit == null).length;
  const limitOf = (s: Suggestion) => limitWithCut(s.typical, cut);

  // A new aim resets every ticked limit to it.
  function chooseCut(c: number) {
    setCut(c);
    setPicked((p) => new Map([...p.keys()].map((id) => {
      const s = data!.suggestions.find((x) => x.categoryId === id)!;
      return [id, String(limitWithCut(s.typical, c))];
    })));
  }
  // Ticked limits against what those categories usually cost.
  const ticked = data.suggestions.filter((s) => picked.has(s.categoryId));
  const usual = ticked.reduce((n, s) => n + s.typical, 0);
  const planned = ticked.reduce((n, s) => n + (Number((picked.get(s.categoryId) ?? "").replace(/[,$\s]/g, "")) || 0), 0);
  const less = usual - planned;

  async function save() {
    setBusy(true);
    let n = 0;
    for (const [categoryId, value] of picked) {
      const limit = Number(value.replace(/[,$\s]/g, ""));
      if (!Number.isFinite(limit) || limit <= 0) continue;
      const res = await fetch("/api/budgets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId, monthlyLimit: limit }) });
      if (res.ok) n++;
    }
    setBusy(false);
    setDone(`${n} budget${n === 1 ? "" : "s"} saved. You'll get an alert at 80% and if one goes over.`);
    setOpen(false);
    onSaved();
    load();
  }

  return (
    <section className="rounded-xl border border-brand-300 bg-brand-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">Suggested budgets</h2>
          <p className="text-sm text-gray-600">
            From your typical month over the last {data.monthsUsed} month{data.monthsUsed === 1 ? "" : "s"} — everyday spending only (rent and EMIs are fixed).
          </p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          {open ? "Close" : fresh ? `Review ${fresh} suggestion${fresh === 1 ? "" : "s"}` : "Review suggestions"}
        </button>
      </div>
      {done && <p className="mt-2 text-sm text-income-600">{done}</p>}
      {open && (
        <>
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-gray-600">How much less than usual?</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How much less than usual">
              {CUTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={cut === c}
                  onClick={() => chooseCut(c)}
                  className={`min-h-[36px] rounded-full border px-3 text-xs font-medium ${cut === c ? "border-ink-900 bg-ink-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                >
                  {c === 0 ? "Same as usual" : `${Math.round(c * 100)}% less`}
                </button>
              ))}
            </div>
            {ticked.length > 0 && (
              <p className={`mt-2 text-sm ${less > 0.5 ? "text-income-600" : "text-gray-600"}`}>
                {less > 0.5
                  ? `About ${usd(less)} a month less than you usually spend in these ${ticked.length} — ${usd(less * 12)} a year.`
                  : `Limits at about what you usually spend in these ${ticked.length}.`}
              </p>
            )}
          </div>
          <ul className="mt-3 divide-y rounded-lg border bg-white">
            {data.suggestions.map((s) => {
              const on = picked.has(s.categoryId);
              return (
                <li key={s.categoryId} className="flex items-center gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setPicked((p) => {
                        const n = new Map(p);
                        if (e.target.checked) n.set(s.categoryId, String(limitOf(s)));
                        else n.delete(s.categoryId);
                        return n;
                      })
                    }
                    className="h-5 w-5 shrink-0"
                    aria-label={`Budget for ${s.name}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block text-xs text-gray-500">
                      usual {usd(s.typical)}{cut > 0 && <> → {usd(limitOf(s))}</>} · average {usd(s.average)} · highest {usd(s.highest)}
                      {s.currentLimit != null && <span className="text-brand-700"> · now {usd(s.currentLimit)}</span>}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-sm">
                    $
                    <input
                      inputMode="decimal"
                      disabled={!on}
                      value={picked.get(s.categoryId) ?? String(limitOf(s))}
                      onChange={(e) => setPicked((p) => new Map(p).set(s.categoryId, e.target.value))}
                      className="w-20 rounded-md border px-2 py-1.5 text-right tabular-nums disabled:bg-gray-50 disabled:text-gray-400"
                      aria-label={`Monthly limit for ${s.name}`}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">A budget already set is replaced by the amount here when ticked.</p>
            <button onClick={save} disabled={busy || picked.size === 0} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Saving…" : `Set ${picked.size} budget${picked.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
