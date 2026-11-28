"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import { EXPIRING_SOON_DAYS, qty, type Pack } from "@/lib/medicines";
import type { MedicineView } from "@/lib/medicineData";

// Medicines at home: how much of each is left, pack by pack with the expiry
// date printed on it, the doses taken, and when it runs out at the usual
// dose. Doses come out of the pack that expires first.

type Data = { today: string; medicines: MedicineView[]; members: string[] };

const day = (d: string) => formatDate(d, { month: "short", day: "numeric", year: "numeric" });
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const UNITS = ["tablets", "capsules", "ml", "drops", "puffs", "sachets", "injections", "patches"];
const num = (s: string) => Number(s.replace(/[,\s]/g, ""));

async function errorOf(res: Response, fallback: string) {
  return (await res.json().catch(() => null))?.error ?? fallback;
}

export default function MedicinesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/medicines${showArchived ? "?archived=1" : ""}`);
    if (!res.ok) return setError(await errorOf(res, "Couldn't load your medicines."));
    setData(await res.json());
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="text-sm text-expense-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const people = Array.from(new Set(data.medicines.map((m) => m.forWhom).filter((x): x is string => !!x))).sort();
  const shown = data.medicines.filter((m) => !person || m.forWhom === person);
  const active = shown.filter((m) => !m.archived);
  const count = (f: string) => active.filter((m) => m.status.flags.includes(f as never)).length;
  const expired = count("EXPIRED");
  const soon = count("EXPIRING");
  const low = count("LOW") + count("OUT");
  // Needing a look first: run out, expired, low, expiring; then by name.
  const order = ["OUT", "EXPIRED", "LOW", "EXPIRING", "WASTE"];
  const rank = (m: MedicineView) => Math.min(9, ...m.status.flags.map((f) => order.indexOf(f)));
  const sorted = [...active].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const archived = shown.filter((m) => m.archived);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Medicines</h1>
          <p className="text-sm text-gray-500">What&apos;s in the cupboard, when it expires, and how long it lasts.</p>
        </div>
        <button onClick={() => setAdding(!adding)} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          {adding ? "Cancel" : "Add a medicine"}
        </button>
      </div>

      {adding && (
        <MedicineForm
          members={data.members}
          people={people}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      <section aria-label="Totals" className="grid grid-cols-3 gap-3">
        <Tile label="Expired" value={expired} tone={expired ? "bad" : "ok"} hint={expired ? "throw away" : "none"} />
        <Tile label={`Expiring in ${EXPIRING_SOON_DAYS} days`} value={soon} tone={soon ? "warn" : "ok"} hint={soon ? "use first" : "none"} />
        <Tile label="Running low" value={low} tone={low ? "warn" : "ok"} hint={low ? "buy more" : "all stocked"} />
      </section>

      {people.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Whose medicines">
          {["", ...people].map((p) => (
            <button
              key={p || "all"}
              onClick={() => setPerson(p)}
              className={`min-h-[34px] rounded-full px-3 ${person === p ? "bg-ink-900 text-white" : "border bg-white text-gray-700"}`}
            >
              {p || "Everyone"}
            </button>
          ))}
        </div>
      )}

      {sorted.length === 0 && (
        <p className="rounded-xl border bg-white p-4 text-sm text-gray-500">
          {data.medicines.length === 0
            ? "No medicines yet. Add one with the pack you have and its expiry date — then tap “Took” each time a dose is taken."
            : "No medicines for this person."}
        </p>
      )}

      {sorted.map((m) => (
        <MedicineCard key={m.id} medicine={m} today={data.today} members={data.members} people={people} onChanged={load} />
      ))}

      <section>
        <button onClick={() => setShowArchived(!showArchived)} className="text-sm text-gray-500 underline">
          {showArchived ? "Hide medicines no longer taken" : "Show medicines no longer taken"}
        </button>
        {showArchived && (
          <div className="mt-3 space-y-3">
            {archived.length === 0 && <p className="text-sm text-gray-500">None.</p>}
            {archived.map((m) => (
              <MedicineCard key={m.id} medicine={m} today={data.today} members={data.members} people={people} onChanged={load} />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-gray-500">
        A pack counts until the end of its expiry date. When a strip only shows a month (EXP 08/2027), use the last day of that month. Each dose comes out of the pack that
        expires first, so older packs get used up before they go to waste.
      </p>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-expense-600" : tone === "warn" ? "text-amber-700" : "text-gray-400";
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm sm:p-4">
      <p className="text-[11px] uppercase leading-tight tracking-wide text-gray-500">{label}</p>
      <p className={`font-display mt-1 text-3xl tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{hint}</p>
    </div>
  );
}

const FLAG: Record<string, { text: (m: MedicineView) => string; cls: string }> = {
  OUT: { text: () => "Out of stock", cls: "bg-red-50 text-expense-600" },
  EXPIRED: { text: (m) => `${qty(m.status.expiredLeft, m.unit)} expired`, cls: "bg-red-50 text-expense-600" },
  LOW: { text: () => "Running low", cls: "bg-amber-50 text-amber-800" },
  EXPIRING: {
    text: (m) => (m.status.daysToExpiry === 0 ? "Expires today" : `Expires in ${m.status.daysToExpiry} day${m.status.daysToExpiry === 1 ? "" : "s"}`),
    cls: "bg-amber-50 text-amber-800",
  },
  WASTE: { text: (m) => `${qty(Math.round(m.status.willExpireUnused), m.unit)} will expire unused`, cls: "bg-gray-100 text-gray-700" },
};

function MedicineCard({ medicine: m, today, members, people, onChanged }: { medicine: MedicineView; today: string; members: string[]; people: string[]; onChanged: () => void }) {
  const [panel, setPanel] = useState<null | "took" | "stock" | "packs" | "history" | "edit">(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const toggle = (k: NonNullable<typeof panel>) => setPanel((v) => (v === k ? null : k));
  const s = m.status;
  const usable = m.packs.filter((p) => !p.discardedOn && p.remaining > 0);
  // The quick button repeats the last amount recorded (5 ml of a syrup, 2
  // tablets at night); before any dose, 1 -- or the whole daily dose when
  // that's less than one (half a tablet a day).
  const oneDose = m.doses[0]?.quantity ?? (m.dailyDose && m.dailyDose < 1 ? m.dailyDose : 1);

  async function tookOne() {
    setBusy(true);
    setNote(null);
    const res = await fetch(`/api/medicines/${m.id}/dose`, json("POST", { quantity: oneDose }));
    setBusy(false);
    if (!res.ok) return setNote(await errorOf(res, "Couldn't record it."));
    const body = await res.json().catch(() => null);
    setNote(body?.warning ?? `Recorded ${qty(oneDose, m.unit)}.`);
    onChanged();
  }

  async function setArchived(archived: boolean) {
    await fetch(`/api/medicines/${m.id}`, json("PUT", { ...m, archived }));
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete ${m.name} with all its packs and dose history? To keep the history, choose “No longer taken” instead.`)) return;
    await fetch(`/api/medicines/${m.id}`, { method: "DELETE" });
    onChanged();
  }

  const supply =
    s.daysLeft != null
      ? s.inStock <= 0
        ? "None left"
        : `Lasts ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} · until ${day(s.runsOutOn!)}`
      : "";

  return (
    <article className={`overflow-hidden rounded-xl border bg-white shadow-sm ${m.archived ? "opacity-70" : ""}`}>
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="break-words font-medium">
            {m.name}
            {m.strength && <span className="font-normal text-gray-500"> {m.strength}</span>}
          </h2>
          <p className="text-xs text-gray-500">
            {[m.forWhom, m.dailyDose != null ? `${qty(m.dailyDose, m.unit)} a day` : null, s.nextExpiry ? `next expiry ${day(s.nextExpiry)}` : null].filter(Boolean).join(" · ") ||
              "No packs yet"}
          </p>
        </div>
        <div className="text-right">
          <p className={`font-display text-xl tabular-nums ${s.inStock <= 0 ? "text-expense-600" : s.low ? "text-amber-700" : ""}`}>{qty(s.inStock, m.unit)}</p>
          <p className="text-xs text-gray-500">{supply || "in stock"}</p>
        </div>
      </header>

      {s.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {s.flags.map((f) => (
            <span key={f} className={`rounded-full px-2 py-0.5 text-xs font-medium ${FLAG[f].cls}`}>
              {FLAG[f].text(m)}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t px-4 py-2 text-sm">
        {!m.archived && (
          <>
            <button onClick={tookOne} disabled={busy} className="min-h-[34px] rounded-md bg-brand-600 px-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? "Saving…" : `Took ${qty(oneDose, m.unit)}`}
            </button>
            <button onClick={() => toggle("took")} className={`min-h-[34px] rounded-md px-3 ${panel === "took" ? "bg-ink-900 text-white" : "border text-gray-700"}`}>
              Other amount
            </button>
            <button onClick={() => toggle("stock")} className={`min-h-[34px] rounded-md px-3 ${panel === "stock" ? "bg-ink-900 text-white" : "border text-gray-700"}`}>
              Add a pack
            </button>
          </>
        )}
        <button onClick={() => toggle("packs")} className={`min-h-[34px] rounded-md px-3 ${panel === "packs" ? "bg-ink-900 text-white" : "border text-gray-700"}`}>
          Packs ({usable.length})
        </button>
        <button onClick={() => toggle("history")} className={`min-h-[34px] rounded-md px-3 ${panel === "history" ? "bg-ink-900 text-white" : "border text-gray-700"}`}>
          Usage
        </button>
        <button onClick={() => toggle("edit")} className={`min-h-[34px] rounded-md px-3 ${panel === "edit" ? "bg-ink-900 text-white" : "text-gray-500"}`}>
          Edit
        </button>
      </div>

      {note && panel === null && <p className="border-t bg-paper px-4 py-2 text-xs text-gray-700">{note}</p>}
      {s.flags.includes("WASTE") && panel === null && (
        <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800">
          At {qty(m.dailyDose!, m.unit)} a day, about {qty(Math.round(s.willExpireUnused), m.unit)} will pass the expiry date before you reach them — no need to buy more yet.
        </p>
      )}

      {panel === "took" && (
        <DoseForm
          medicine={m}
          onSaved={(w) => {
            setPanel(null);
            setNote(w);
            onChanged();
          }}
        />
      )}
      {panel === "stock" && (
        <StockForm
          medicine={m}
          onSaved={() => {
            setPanel(null);
            onChanged();
          }}
        />
      )}
      {panel === "packs" && <PackList medicine={m} today={today} onChanged={onChanged} />}
      {panel === "history" && <Usage medicine={m} onChanged={onChanged} />}
      {panel === "edit" && (
        <div className="border-t p-4">
          <MedicineForm
            medicine={m}
            members={members}
            people={people}
            onSaved={() => {
              setPanel(null);
              onChanged();
            }}
          />
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <button onClick={() => setArchived(!m.archived)} className="text-gray-600 underline">
              {m.archived ? "Taking it again" : "No longer taken"}
            </button>
            <button onClick={remove} className="text-expense-600 underline">
              Delete {m.name}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function MedicineForm({ medicine, members, people, onSaved }: { medicine?: MedicineView; members: string[]; people: string[]; onSaved: () => void }) {
  const [f, setF] = useState({
    name: medicine?.name ?? "",
    strength: medicine?.strength ?? "",
    unit: medicine?.unit ?? "tablets",
    forWhom: medicine?.forWhom ?? "",
    dailyDose: medicine?.dailyDose != null ? String(medicine.dailyDose) : "",
    lowStockAt: medicine?.lowStockAt != null ? String(medicine.lowStockAt) : "",
    notes: medicine?.notes ?? "",
    // The first pack, when adding.
    quantity: "",
    expiresOn: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const names = Array.from(new Set([...members, ...people])).sort();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setErr("Give the medicine a name.");
    if (f.dailyDose && !(num(f.dailyDose) > 0)) return setErr("The daily dose should be a number above 0.");
    if (!medicine && f.quantity && !(num(f.quantity) > 0)) return setErr("How many are in the pack? Enter a number above 0.");
    setBusy(true);
    setErr(null);
    const body = {
      name: f.name,
      strength: f.strength,
      unit: f.unit,
      forWhom: f.forWhom,
      dailyDose: f.dailyDose ? num(f.dailyDose) : null,
      lowStockAt: f.lowStockAt ? num(f.lowStockAt) : null,
      notes: f.notes,
      ...(!medicine && f.quantity ? { stock: { quantity: num(f.quantity), expiresOn: f.expiresOn || null } } : {}),
    };
    const res = await fetch(medicine ? `/api/medicines/${medicine.id}` : "/api/medicines", json(medicine ? "PUT" : "POST", body));
    setBusy(false);
    if (!res.ok) return setErr(await errorOf(res, "Couldn't save it."));
    onSaved();
  }

  const label = "text-xs font-medium text-gray-600";
  const input = "mt-1 block w-full rounded border bg-white px-2 py-1.5 text-base font-normal";
  return (
    <form onSubmit={save} className={`space-y-3 text-sm ${medicine ? "" : "rounded-xl border bg-white p-4 shadow-sm"}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className={`${label} col-span-2`}>
          Name
          <input value={f.name} onChange={set("name")} placeholder="Paracetamol" maxLength={200} className={input} autoFocus={!medicine} />
        </label>
        <label className={label}>
          Strength
          <input value={f.strength} onChange={set("strength")} placeholder="500 mg" maxLength={50} className={input} />
        </label>
        <label className={label}>
          Counted in
          <select value={f.unit} onChange={set("unit")} className={input}>
            {Array.from(new Set([...UNITS, f.unit])).map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          For
          <input value={f.forWhom} onChange={set("forWhom")} list="medicine-people" placeholder="Anyone" maxLength={100} className={input} />
          <datalist id="medicine-people">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label className={label}>
          Daily dose
          <input value={f.dailyDose} onChange={set("dailyDose")} inputMode="decimal" placeholder="e.g. 2" className={input} />
        </label>
        <label className={`${label} col-span-2`}>
          Running low at
          <input value={f.lowStockAt} onChange={set("lowStockAt")} inputMode="decimal" placeholder={f.dailyDose ? "a week's supply" : "e.g. 5"} className={input} />
        </label>
        {!medicine && (
          <>
            <label className={label}>
              In the pack
              <input value={f.quantity} onChange={set("quantity")} inputMode="decimal" placeholder={`no. of ${f.unit}`} className={input} />
            </label>
            <label className={`${label} col-span-2 sm:col-span-1`}>
              Expires on
              <input type="date" value={f.expiresOn} onChange={set("expiresOn")} className={input} />
            </label>
          </>
        )}
      </div>
      <input value={f.notes} onChange={set("notes")} placeholder="Notes: after food, prescribed by… (optional)" maxLength={1000} className="w-full rounded border bg-white px-2 py-1.5" />
      <p className="text-xs text-gray-500">The daily dose is for the forecast (how long it lasts, what expires first). Leave it empty for medicines taken only when needed.</p>
      {err && <p className="text-xs text-expense-600">{err}</p>}
      <button type="submit" disabled={busy} className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "Saving…" : medicine ? "Save changes" : "Add medicine"}
      </button>
    </form>
  );
}

function DoseForm({ medicine: m, onSaved }: { medicine: MedicineView; onSaved: (warning: string | null) => void }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayLocal());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = num(amount);
    if (!(v > 0)) return setErr(`Enter how many ${m.unit} were taken.`);
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/medicines/${m.id}/dose`, json("POST", { quantity: v, takenOn: date, note: text.trim() || undefined }));
    setBusy(false);
    if (!res.ok) return setErr(await errorOf(res, "Couldn't record it."));
    const body = await res.json().catch(() => null);
    onSaved(body?.warning ?? `Recorded ${qty(v, m.unit)}.`);
  }

  return (
    <form onSubmit={save} className="space-y-2 border-t bg-paper p-4 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-gray-600">
          How many {m.unit}
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus className="mt-1 block w-28 rounded border bg-white px-2 py-1.5 text-base font-normal tabular-nums" />
        </label>
        <label className="text-xs font-medium text-gray-600">
          Taken on
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block rounded border bg-white px-2 py-1.5 text-base font-normal" />
        </label>
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Note (optional)" maxLength={200} className="w-full rounded border bg-white px-2 py-1.5" />
      {err && <p className="text-xs text-expense-600">{err}</p>}
      <button type="submit" disabled={busy} className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "Saving…" : "Record"}
      </button>
    </form>
  );
}

function StockForm({ medicine: m, onSaved }: { medicine: MedicineView; onSaved: () => void }) {
  const [quantity, setQuantity] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = num(quantity);
    if (!(v > 0)) return setErr(`How many ${m.unit} are in the pack?`);
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/medicines/${m.id}/stock`, json("POST", { quantity: v, expiresOn: expiresOn || null, note: text.trim() || undefined }));
    setBusy(false);
    if (!res.ok) return setErr(await errorOf(res, "Couldn't add the pack."));
    onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-2 border-t bg-paper p-4 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-gray-600">
          {m.unit[0].toUpperCase() + m.unit.slice(1)} in the pack
          <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus className="mt-1 block w-28 rounded border bg-white px-2 py-1.5 text-base font-normal tabular-nums" />
        </label>
        <label className="text-xs font-medium text-gray-600">
          Expires on
          <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className="mt-1 block rounded border bg-white px-2 py-1.5 text-base font-normal" />
        </label>
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Note: pharmacy, batch no. (optional)" maxLength={200} className="w-full rounded border bg-white px-2 py-1.5" />
      {err && <p className="text-xs text-expense-600">{err}</p>}
      <button type="submit" disabled={busy} className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "Saving…" : "Add pack"}
      </button>
    </form>
  );
}

function PackList({ medicine: m, today, onChanged }: { medicine: MedicineView; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [left, setLeft] = useState("");
  const [exp, setExp] = useState("");

  async function update(p: Pack, body: Record<string, unknown>) {
    const res = await fetch(`/api/medicines/stock/${p.id}`, json("PUT", body));
    if (!res.ok) return alert(await errorOf(res, "Couldn't save it."));
    setEditing(null);
    onChanged();
  }
  async function discard(p: Pack) {
    if (!confirm(`Throw away the ${qty(p.remaining, m.unit)} left in this pack?`)) return;
    update(p, { discard: true });
  }
  async function remove(p: Pack) {
    if (!confirm("Delete this pack? Use this for a pack added by mistake.")) return;
    await fetch(`/api/medicines/stock/${p.id}`, { method: "DELETE" });
    onChanged();
  }

  if (m.packs.length === 0) return <p className="border-t px-4 py-3 text-sm text-gray-500">No packs yet. &ldquo;Add a pack&rdquo; with its expiry date.</p>;
  return (
    <ul className="divide-y border-t text-sm">
      {m.packs.map((p) => {
        const expired = p.expiresOn != null && p.expiresOn < today;
        const gone = !!p.discardedOn || p.remaining <= 0;
        return (
          <li key={p.id} className={`px-4 py-2 ${gone ? "text-gray-400" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="block tabular-nums">
                  {qty(p.remaining, m.unit)} <span className="text-gray-500">of {p.quantity}</span>
                </span>
                <span className="block text-xs text-gray-500">
                  {p.discardedOn ? `Thrown away ${day(p.discardedOn)}` : p.remaining <= 0 ? "Used up" : p.expiresOn ? `${expired ? "Expired" : "Expires"} ${day(p.expiresOn)}` : "No expiry date"} · added{" "}
                  {day(p.addedOn)}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
              </span>
              {!gone && (
                <span className="flex shrink-0 gap-3 text-xs">
                  <button
                    onClick={() => {
                      setEditing(editing === p.id ? null : p.id);
                      setLeft(String(p.remaining));
                      setExp(p.expiresOn ?? "");
                    }}
                    className="text-gray-600 underline"
                  >
                    Correct
                  </button>
                  <button onClick={() => discard(p)} className={`underline ${expired ? "font-medium text-expense-600" : "text-gray-600"}`}>
                    Throw away
                  </button>
                </span>
              )}
              {gone && (
                <button onClick={() => remove(p)} className="shrink-0 text-xs text-gray-400 underline">
                  Delete
                </button>
              )}
            </div>
            {editing === p.id && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-xs font-medium text-gray-600">
                  Left now
                  <input inputMode="decimal" value={left} onChange={(e) => setLeft(e.target.value)} className="mt-1 block w-24 rounded border bg-white px-2 py-1 text-base font-normal" />
                </label>
                <label className="text-xs font-medium text-gray-600">
                  Expires on
                  <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} className="mt-1 block rounded border bg-white px-2 py-1 text-base font-normal" />
                </label>
                <button
                  onClick={() => {
                    const v = num(left);
                    if (!(v >= 0)) return alert("Enter how many are left, 0 or more.");
                    update(p, { remaining: v, expiresOn: exp || null });
                  }}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-white"
                >
                  Save
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Usage({ medicine: m, onChanged }: { medicine: MedicineView; onChanged: () => void }) {
  async function undo(id: string) {
    if (!confirm("Remove this dose? What it took goes back into its pack.")) return;
    await fetch(`/api/medicines/dose/${id}`, { method: "DELETE" });
    onChanged();
  }
  // Doses by day, newest first.
  const byDay = new Map<string, MedicineView["doses"]>();
  for (const d of m.doses) byDay.set(d.takenOn, [...(byDay.get(d.takenOn) ?? []), d]);
  const perDay = m.status.usedLast30 / 30;

  return (
    <div className="border-t px-4 py-3 text-sm">
      <p className="mb-2 text-xs text-gray-600">
        Last 30 days: {qty(m.status.usedLast30, m.unit)}
        {m.status.usedLast30 > 0 && ` · about ${qty(Math.round(perDay * 10) / 10, m.unit)} a day`}
        {m.dailyDose != null && m.status.usedLast30 > 0 && Math.abs(perDay - m.dailyDose) / m.dailyDose > 0.25 && (
          <span className="text-amber-700"> · the daily dose is set to {m.dailyDose}; some doses may not be recorded</span>
        )}
      </p>
      {m.doses.length === 0 ? (
        <p className="text-gray-500">No doses recorded in the last 90 days.</p>
      ) : (
        <ul className="divide-y">
          {Array.from(byDay.entries()).map(([d, list]) => (
            <li key={d} className="py-1.5">
              <span className="text-xs font-medium text-gray-500">{day(d)}</span>
              <ul>
                {list.map((x) => (
                  <li key={x.id} className="flex items-baseline justify-between gap-3">
                    <span>
                      {qty(x.quantity, m.unit)}
                      <span className="text-xs text-gray-500">
                        {x.by ? ` · by ${x.by}` : ""}
                        {x.note ? ` · ${x.note}` : ""}
                      </span>
                    </span>
                    <button onClick={() => undo(x.id)} className="text-xs text-gray-400 underline">
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
