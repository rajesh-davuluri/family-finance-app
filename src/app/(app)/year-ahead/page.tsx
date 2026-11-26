"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/formatDate";
import { CURRENCIES } from "@/lib/enums";
import { PlanRow, PlannedItem, REPEAT_OPTIONS, repeatLabel, upcoming, yearAheadPlan } from "@/lib/yearAhead";

// Year ahead: the big costs of the next 12 months that don't come every
// month, what to set aside from each paycheck so each is covered on its due
// date, and whether the money set aside so far is keeping up. The plan is
// worked out here from /api/year-ahead, so every change shows at once.

type Suggestion = { key: string; name: string; amount: number; currency: string; usd: number; dueDate: string; repeatMonths: number | null; from: string };
type Data = {
  today: string;
  items: PlannedItem[];
  paydays: string[];
  paydaysAssumed: boolean;
  paycheckUsd: number | null;
  setAsideUsd: number;
  perPaydayUsd: number | null;
  suggestions: Suggestion[];
};
type Form = { id: string | null; name: string; amount: string; currency: string; dueDate: string; repeatMonths: number | null };

const usd = (n: number, d = 0) => money(n, "USD", d);
const day = (d: string) => formatDate(d, { month: "short", day: "numeric", year: "numeric" });
const short = (d: string) => formatDate(d, { month: "short", day: "numeric" });
const num = (s: string) => {
  const n = Number(s.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const blank: Form = { id: null, name: "", amount: "", currency: "USD", dueDate: "", repeatMonths: null };
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function YearAheadPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [potEdit, setPotEdit] = useState<string | null>(null);
  const [rateEdit, setRateEdit] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch("/api/year-ahead", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const plan = useMemo(() => {
    if (!data) return null;
    return yearAheadPlan({ today: data.today, occurrences: upcoming(data.items, data.today), paydays: data.paydays, setAsideUsd: data.setAsideUsd, perPaydayUsd: data.perPaydayUsd });
  }, [data]);

  async function saveSettings(patch: { setAsideUsd?: number; perPaydayUsd?: number | null }) {
    if (!data) return;
    setData({ ...data, ...patch });
    await fetch("/api/year-ahead", json("PUT", patch));
  }

  async function savePot() {
    const v = potEdit == null ? NaN : num(potEdit);
    if (Number.isNaN(v)) return;
    setPotEdit(null);
    await saveSettings({ setAsideUsd: v });
  }

  async function saveRate() {
    if (rateEdit == null) return;
    const v = rateEdit.trim() === "" ? null : num(rateEdit);
    if (v !== null && Number.isNaN(v)) return;
    setRateEdit(null);
    await saveSettings({ perPaydayUsd: v });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const amount = num(form.amount);
    if (!form.name.trim() || !(amount > 0) || !form.dueDate) {
      setFormError("Give it a name, an amount and a due date.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const body = { name: form.name, amount, currency: form.currency, dueDate: form.dueDate, repeatMonths: form.repeatMonths };
    const res = await fetch(form.id ? `/api/year-ahead/${form.id}` : "/api/year-ahead", json(form.id ? "PUT" : "POST", body));
    setBusy(false);
    if (!res.ok) {
      setFormError("Couldn't save that. Check the amount and date.");
      return;
    }
    setForm(null);
    load();
  }

  async function addSuggestion(s: Suggestion) {
    setBusy(true);
    await fetch("/api/year-ahead", json("POST", { name: s.name, amount: s.amount, currency: s.currency, dueDate: s.dueDate, repeatMonths: s.repeatMonths, sourceKey: s.key }));
    setBusy(false);
    load();
  }

  async function markPaid(r: PlanRow) {
    const next = r.repeatMonths ? " It moves on to its next due date." : " It comes off the list.";
    if (!confirm(`Mark ${r.name} (${usd(r.usd)}) as paid?${next}${r.savedUsd > 0 ? ` ${usd(Math.min(r.usd, data?.setAsideUsd ?? 0))} leaves the money set aside.` : ""}`)) return;
    await fetch(`/api/year-ahead/${r.itemId}/paid`, json("POST", {}));
    load();
  }

  async function remove(r: PlanRow) {
    if (!confirm(`Remove ${r.name} from the year ahead?${r.repeatMonths ? " All its repeats go too." : ""}`)) return;
    await fetch(`/api/year-ahead/${r.itemId}`, { method: "DELETE" });
    load();
  }

  if (error) return <p className="text-sm text-expense-600">Couldn&apos;t load the year ahead. Try again in a moment.</p>;
  if (!data || !plan) return <p className="text-sm text-gray-400">Loading...</p>;

  const empty = plan.rows.length === 0;
  const custom = data.perPaydayUsd != null;
  const peak = Math.max(1, ...plan.months.map((m) => m.usd));
  const share = data.paycheckUsd && plan.rate > 0 ? Math.round((plan.rate / data.paycheckUsd) * 100) : null;
  const allCovered = !empty && plan.gapUsd <= 0.005;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Year ahead</h1>
          <p className="text-sm text-gray-500">
            {empty ? "The big costs that don't come every month, spread over your paychecks." : `${plan.rows.length} big cost${plan.rows.length === 1 ? "" : "s"} in the next 12 months · ${usd(plan.totalUsd)}`}
          </p>
        </div>
        <button onClick={() => (setFormError(null), setForm(form ? null : blank))} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          {form ? "Cancel" : "Add a cost"}
        </button>
      </div>

      {form && (
        <form onSubmit={submit} className="grid grid-cols-2 gap-3 rounded-xl border bg-white p-4 shadow-sm sm:grid-cols-4">
          <label className="col-span-2 text-sm font-medium sm:col-span-4">
            What is it
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Trip to India, car insurance, school fees…" className="mt-1 w-full rounded-md border px-3 py-2 text-base font-normal" />
          </label>
          <label className="text-sm font-medium">
            Amount
            <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" className="mt-1 w-full rounded-md border px-3 py-2 text-base font-normal tabular-nums" />
          </label>
          <label className="text-sm font-medium">
            Currency
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-base font-normal">
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Due
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 text-base font-normal" />
          </label>
          <label className="text-sm font-medium">
            Repeats
            <select value={form.repeatMonths ?? ""} onChange={(e) => setForm({ ...form, repeatMonths: e.target.value ? Number(e.target.value) : null })} className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-base font-normal">
              {REPEAT_OPTIONS.map((r) => (
                <option key={r.label} value={r.months ?? ""}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {formError && <p className="col-span-2 text-sm text-expense-600 sm:col-span-4">{formError}</p>}
          <button type="submit" disabled={busy} className="col-span-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:col-span-4">
            {form.id ? "Save changes" : "Add to the year ahead"}
          </button>
        </form>
      )}

      {!empty && (
        <section aria-label="Set aside each paycheck" className="rounded-xl bg-ink-900 p-4 text-white shadow-sm">
          <p className="text-xs uppercase tracking-wide text-ink-300">{allCovered ? "Everything is covered" : "Set aside from each paycheck"}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <p className={`font-display text-4xl tabular-nums ${plan.behind ? "text-red-300" : "text-brand-300"}`}>{usd(plan.rate)}</p>
            {custom && Math.abs(plan.rate - plan.needPerPayday) >= 1 && <p className="text-sm text-ink-300 tabular-nums">it takes {usd(plan.needPerPayday)}</p>}
          </div>
          <p className="mt-1 text-sm text-ink-300">
            {allCovered
              ? `The ${usd(plan.setAsideUsd)} set aside already pays for all of it.`
              : plan.behind
                ? `That leaves ${plan.firstShort ? `${plan.firstShort.name} ${usd(plan.firstShort.shortUsd)} short on ${short(plan.firstShort.when)}` : "something short"}. ${usd(plan.needPerPayday)} a paycheck covers everything on time.`
                : `Covers every cost by the day it's due${share != null ? ` — about ${share}% of a paycheck` : ""}.`}
            {!allCovered && !plan.behind && plan.setBy && plan.rows.length > 1 && ` Sized by ${plan.setBy.name}, due ${short(plan.setBy.date)}.`}
          </p>

          {plan.dueNowShort > 0 && (
            <p className="mt-2 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100">
              ⚠ {usd(plan.dueNowShort)} falls due before your next paycheck and isn&apos;t set aside. It&apos;s too late to save for it — it will come out of the bank. Check the{" "}
              <Link href="/plan" className="underline">
                payday planner
              </Link>
              .
            </p>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-white/15 pt-3 text-sm">
            <div>
              <dt className="text-xs text-ink-300">Set aside so far</dt>
              <dd className="mt-0.5">
                {potEdit == null ? (
                  <button onClick={() => setPotEdit(String(data.setAsideUsd || ""))} className="font-medium tabular-nums underline decoration-white/40">
                    {usd(plan.setAsideUsd)}
                  </button>
                ) : (
                  <Inline value={potEdit} onChange={setPotEdit} onSave={savePot} label="Set aside so far" />
                )}
                <span className="text-ink-300"> of {usd(plan.totalUsd)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-300">Each paycheck</dt>
              <dd className="mt-0.5">
                {rateEdit == null ? (
                  <button onClick={() => setRateEdit(custom ? String(data.perPaydayUsd) : "")} className="font-medium tabular-nums underline decoration-white/40">
                    {custom ? usd(plan.rate) : "What it takes"}
                  </button>
                ) : (
                  <Inline value={rateEdit} onChange={setRateEdit} onSave={saveRate} label="Each paycheck" placeholder={String(plan.needPerPayday)} />
                )}
                {custom && rateEdit == null && (
                  <button onClick={() => saveSettings({ perPaydayUsd: null })} className="ml-2 text-xs text-ink-300 underline">
                    reset
                  </button>
                )}
              </dd>
            </div>
          </dl>
          <div className="mt-3 h-2 w-full rounded-full bg-white/15" aria-hidden>
            <div className="h-2 rounded-full bg-brand-300" style={{ width: `${plan.totalUsd > 0 ? Math.min(100, (plan.setAsideUsd / plan.totalUsd) * 100) : 0}%` }} />
          </div>
          {plan.rate > 0 && (
            <button onClick={() => saveSettings({ setAsideUsd: Math.round((data.setAsideUsd + plan.rate) * 100) / 100 })} className="mt-3 w-full rounded-lg bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20">
              I set aside {usd(plan.rate)} this payday
            </button>
          )}
        </section>
      )}

      {!empty && (
        <section aria-label="By month" className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="font-display text-lg">When it lands</h2>
          <div className="mt-3 flex h-28 items-end gap-1" role="img" aria-label={`Costs by month, the largest ${usd(peak)}`}>
            {plan.months.map((m) => (
              <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={m.usd > 0 ? `${formatDate(`${m.month}-01`, { month: "long", year: "numeric" })}: ${usd(m.usd)}` : undefined}>
                {m.usd > 0 && <span className="hidden text-[10px] tabular-nums text-gray-500 sm:block">{m.usd >= 1000 ? `$${(m.usd / 1000).toFixed(1)}k` : usd(m.usd)}</span>}
                <div className={`w-full rounded-t ${m.usd > 0 ? "bg-brand-500" : "bg-gray-100"}`} style={{ height: m.usd > 0 ? `${Math.max(6, (m.usd / peak) * 100)}%` : "2px" }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-center text-[10px] uppercase text-gray-400">
            {plan.months.map((m) => (
              <span key={m.month} className="min-w-0 flex-1">
                {formatDate(`${m.month}-01`, { month: "short" }).slice(0, 3)}
              </span>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Costs" className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="font-display text-lg">The next 12 months</h2>
        {empty ? (
          <p className="mt-2 text-sm text-gray-500">
            Nothing here yet. Add the costs that catch a family out — insurance premiums, a trip to India, school fees, car registration, property tax — and this page turns them into one small amount per paycheck.
          </p>
        ) : (
          <ol className="mt-2 divide-y text-sm">
            {plan.rows.map((r) => (
              <li key={r.key} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 font-medium">
                    {r.name}
                    {r.repeatMonths && <span className="ml-1.5 whitespace-nowrap text-xs font-normal text-gray-400">{repeatLabel(r.repeatMonths).toLowerCase()}</span>}
                  </p>
                  <p className="shrink-0 tabular-nums">
                    {usd(r.usd)}
                    {r.currency !== "USD" && <span className="ml-1 text-xs text-gray-400">{money(r.amount, r.currency, 0)}</span>}
                  </p>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs">
                  <p className={r.overdue ? "font-medium text-expense-600" : "text-gray-500"}>
                    {r.overdue ? `Was due ${day(r.date)}` : day(r.date)}
                    {!r.overdue && ` · ${r.paychecksBefore === 0 ? "before your next paycheck" : `${r.paychecksBefore} paycheck${r.paychecksBefore === 1 ? "" : "s"} away`}`}
                  </p>
                  <Status row={r} />
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100" aria-hidden>
                  <div className={`h-1.5 rounded-full ${r.status === "SHORT" ? "bg-expense-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, (r.savedUsd / r.usd) * 100)}%` }} />
                </div>
                {r.first && (
                  <div className="mt-1.5 flex gap-4 text-xs">
                    <button onClick={() => markPaid(r)} className="font-medium text-brand-700 hover:underline">
                      Mark as paid
                    </button>
                    <button
                      onClick={() => {
                        const it = data.items.find((i) => i.id === r.itemId);
                        if (!it) return;
                        setFormError(null);
                        setForm({ id: it.id, name: it.name, amount: String(it.amount), currency: it.currency, dueDate: it.dueDate, repeatMonths: it.repeatMonths });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="text-gray-500 hover:underline"
                    >
                      Edit
                    </button>
                    <button onClick={() => remove(r)} className="text-gray-500 hover:underline">
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {data.suggestions.length > 0 && (
        <section aria-label="Suggestions" className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="font-display text-lg">Already in your records</h2>
          <p className="text-sm text-gray-500">Premiums and bills that come a few times a year or less. Add the ones your paychecks pay for.</p>
          <ul className="mt-2 divide-y text-sm">
            {data.suggestions.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="text-xs text-gray-500">
                    {s.from} · {day(s.dueDate)} · {repeatLabel(s.repeatMonths).toLowerCase()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-right tabular-nums">
                    {usd(s.usd)}
                    {s.currency !== "USD" && <span className="block text-xs text-gray-400">{money(s.amount, s.currency, 0)}</span>}
                  </span>
                  <button onClick={() => addSuggestion(s)} disabled={busy} className="rounded-md border border-brand-600 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                    Add
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-gray-500">
        {data.paydaysAssumed ? "No salary recorded yet, so this assumes a paycheck every two weeks." : `Paychecks every 14 days on from your last one (${plan.paydaysLeft} in the next 12 months).`} The amount per paycheck is the smallest steady amount that has
        every cost paid for by its due date, so it drops once the cost that sets it has passed. Money set aside pays the earliest costs first, and the payday planner keeps it out of &ldquo;safe to spend&rdquo;. Rupee amounts use an approximate rate.
      </p>
    </div>
  );
}

function Status({ row }: { row: PlanRow }) {
  if (row.status === "COVERED") return <span className="shrink-0 font-medium text-income-600">Covered</span>;
  if (row.status === "ON_TRACK") return <span className="shrink-0 text-gray-500">On track{row.savedUsd > 0 ? ` · ${usd(row.savedUsd)} saved` : ""}</span>;
  return <span className="shrink-0 font-medium text-expense-600">{usd(row.shortUsd)} short</span>;
}

function Inline({ value, onChange, onSave, label, placeholder }: { value: string; onChange: (v: string) => void; onSave: () => void; label: string; placeholder?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      $
      <input
        autoFocus
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSave()}
        className="w-20 rounded border border-white/30 bg-transparent px-1.5 py-0.5 text-right text-base text-white placeholder:text-ink-300"
        aria-label={label}
      />
      <button onClick={onSave} className="rounded bg-brand-600 px-2 py-0.5 text-xs text-white">
        Save
      </button>
    </span>
  );
}
