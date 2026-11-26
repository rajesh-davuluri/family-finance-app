"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/formatDate";
import { FREQUENCY_LABELS } from "@/lib/recurringDetect";
import { alertText, isHidden, type Subscription, type SubscriptionAlert } from "@/lib/subscriptions";

// Subscriptions: everything that charges on a schedule -- streaming, apps,
// memberships, phone plans -- found in the transactions, with price rises,
// double charges, new ones and charges after you chose to cancel. Keep or
// Cancel each once; the app remembers and flags anything that changes.

type Totals = { count: number; perMonthUsd: number; perYearUsd: number; toCancelPerYearUsd: number };
type Data = { today: string; subscriptions: Subscription[]; totals: Totals };

const usd = (n: number, d = 2) => money(n, "USD", d);
const day = (d: string) => formatDate(d, { month: "short", day: "numeric", year: "numeric" });
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const every: Record<string, string> = { WEEKLY: "a week", BIWEEKLY: "every 2 weeks", MONTHLY: "a month", QUARTERLY: "a quarter", HALF_YEARLY: "every 6 months", YEARLY: "a year" };
const urgent = (a: SubscriptionAlert) => a.kind === "CHARGED_AFTER_CANCEL" || a.kind === "DOUBLE" || a.kind === "PRICE_UP";

export default function SubscriptionsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const load = useCallback(() => {
    fetch("/api/subscriptions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  async function mark(s: Subscription, status: "KEEP" | "CANCEL" | "HIDDEN" | null) {
    setBusy(s.key);
    const r = await fetch("/api/subscriptions/mark", json("PUT", { key: s.key, status, amount: s.amount }));
    setBusy(null);
    if (!r.ok) return alert("Couldn't save that. Try again.");
    load();
  }

  async function addToRecurring(s: Subscription) {
    if (!s.addable) return;
    setBusy(s.key);
    const r = await fetch("/api/recurring", json("POST", { amount: s.amount, currency: s.currency, ...s.addable, nextRunAt: s.addable.nextRunAt }));
    setBusy(null);
    if (!r.ok) return alert("Couldn't add it to Recurring bills.");
    load();
  }

  if (error) return <p className="text-sm text-expense-600">Couldn&apos;t load subscriptions. Try again in a moment.</p>;
  if (!data) return <p className="text-sm text-gray-400">Looking through your transactions...</p>;

  const hidden = data.subscriptions.filter(isHidden);
  const subs = data.subscriptions.filter((s) => !isHidden(s));
  const current = subs.filter((s) => s.status === "ACTIVE" || s.status === "LATE");
  const once = subs.filter((s) => s.status === "SEEN_ONCE");
  const stopped = subs.filter((s) => s.status === "STOPPED");
  const order = ["CHARGED_AFTER_CANCEL", "DOUBLE", "PRICE_UP", "NEW", "PRICE_DOWN"];
  const alerts = subs.flatMap((s) => s.alerts.map((a) => ({ s, a }))).sort((x, y) => order.indexOf(x.a.kind) - order.indexOf(y.a.kind));
  const undecided = current.filter((s) => !s.mark).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl">Subscriptions</h1>
        <p className="text-sm text-gray-500">
          Everything that charges on a schedule, found in your transactions. Mark each one Keep or Cancel once; you&apos;ll hear about a price rise, a double
          charge, a new one, or a charge after you chose to cancel.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="A month" value={usd(data.totals.perMonthUsd)} sub={`${data.totals.count} subscription${data.totals.count === 1 ? "" : "s"}`} strong />
        <Tile label="A year" value={usd(data.totals.perYearUsd, 0)} sub="at today's prices" />
        <Tile label="To decide" value={String(undecided)} sub={undecided ? "Keep or Cancel below" : "all decided"} />
        <Tile label="Marked to cancel" value={usd(data.totals.toCancelPerYearUsd, 0)} sub="saved a year once cancelled" />
      </section>

      {alerts.length > 0 && (
        <section aria-label="Changes" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-amber-800">What changed · {alerts.length}</p>
          <ul className="space-y-1">
            {alerts.map(({ s, a }, i) => (
              <li key={`${s.key}:${a.kind}:${i}`} className="flex items-start gap-2 px-1 py-1 text-sm">
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${urgent(a) ? "bg-expense-500" : "bg-amber-500"}`} />
                <span>{alertText(s, a, (n) => money(n, s.currency), (d) => formatDate(d, { month: "short", day: "numeric" }))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {current.length === 0 && once.length === 0 ? (
        <p className="rounded-xl border bg-white p-4 text-sm text-gray-500">
          No subscriptions found yet. They show up once a charge repeats (or from the first charge for well-known services like Netflix or Spotify). Import your
          card statements on <Link href="/import" className="text-brand-600 underline">Import</Link>.
        </p>
      ) : (
        <ul className="space-y-2">
          {current.map((s) => (
            <Row key={s.key} s={s} busy={busy === s.key} onMark={mark} onAdd={addToRecurring} />
          ))}
        </ul>
      )}

      {once.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-medium text-gray-700">Charged once so far</h2>
          <p className="mb-2 text-xs text-gray-500">Looks like a subscription that just started (a free trial that became paid?). Not in the totals until it repeats.</p>
          <ul className="space-y-2">
            {once.map((s) => (
              <Row key={s.key} s={s} busy={busy === s.key} onMark={mark} onAdd={addToRecurring} />
            ))}
          </ul>
        </section>
      )}

      {stopped.length > 0 && (
        <section>
          <button onClick={() => setShowStopped((v) => !v)} className="text-sm font-medium text-gray-700" aria-expanded={showStopped}>
            {showStopped ? "▾" : "▸"} Not charged lately · {stopped.length}
          </button>
          {showStopped && (
            <>
              <p className="mb-2 mt-1 text-xs text-gray-500">These used to charge but haven&apos;t for a while: cancelled, or a statement not imported yet.</p>
              <ul className="space-y-2">
                {stopped.map((s) => (
                  <Row key={s.key} s={s} busy={busy === s.key} onMark={mark} onAdd={addToRecurring} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {hidden.length > 0 && (
        <section>
          <button onClick={() => setShowHidden((v) => !v)} className="text-sm font-medium text-gray-700" aria-expanded={showHidden}>
            {showHidden ? "▾" : "▸"} Not subscriptions · {hidden.length}
          </button>
          {showHidden && (
            <ul className="mt-2 divide-y rounded-xl border bg-white">
              {hidden.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {s.name} <span className="text-gray-500">· {money(s.amount, s.currency)} · {s.accounts.join(", ")}</span>
                  </span>
                  <button disabled={busy === s.key} onClick={() => mark(s, null)} className="shrink-0 text-xs font-medium text-brand-700 hover:underline disabled:opacity-50">
                    Show again
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p className="text-xs text-gray-400">Found from repeating charges in your last year of transactions. Totals in approximate USD.</p>
    </div>
  );
}

function Row({ s, busy, onMark, onAdd }: { s: Subscription; busy: boolean; onMark: (s: Subscription, status: "KEEP" | "CANCEL" | "HIDDEN" | null) => void; onAdd: (s: Subscription) => void }) {
  const live = s.status === "ACTIVE" || s.status === "LATE";
  const btn = (on: boolean, tone: string) => `min-h-[32px] rounded-md border px-2.5 text-xs font-medium disabled:opacity-50 ${on ? tone : "text-gray-600 hover:bg-gray-50"}`;
  return (
    <li className={`rounded-xl border bg-white p-3 shadow-sm ${s.mark?.status === "CANCEL" ? "border-expense-500/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-medium">
            {s.name}
            {s.mark?.status === "KEEP" && <span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-income-600">Keep</span>}
            {s.mark?.status === "CANCEL" && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-expense-600">Cancel</span>}
          </p>
          <p className="text-xs text-gray-500">
            {s.accounts.join(", ")} · {s.categoryName}
            {s.status === "LATE" && <span className="text-amber-700"> · late: last charged {day(s.lastDate)}</span>}
            {s.status === "STOPPED" && <> · last charged {day(s.lastDate)}</>}
            {s.status === "SEEN_ONCE" && <> · charged {day(s.lastDate)}</>}
            {live && s.nextDate && <> · next ~{day(s.nextDate)}</>}
          </p>
        </div>
        <div className="text-right tabular-nums">
          <p className="font-display text-lg leading-tight">
            {money(s.amount, s.currency)}
            {s.frequency && <span className="font-sans text-xs text-gray-500"> {every[s.frequency] ?? FREQUENCY_LABELS[s.frequency]}</span>}
          </p>
          {live && s.frequency !== "YEARLY" && s.perYearUsd > 0 && <p className="text-xs text-gray-500">{usd(s.perYearUsd, 0)} a year</p>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button disabled={busy} onClick={() => onMark(s, s.mark?.status === "KEEP" ? null : "KEEP")} className={btn(s.mark?.status === "KEEP", "border-income-500 bg-green-50 text-income-600")}>
          Keep
        </button>
        <button disabled={busy} onClick={() => onMark(s, s.mark?.status === "CANCEL" ? null : "CANCEL")} className={btn(s.mark?.status === "CANCEL", "border-expense-500 bg-red-50 text-expense-600")}>
          Cancel
        </button>
        {s.inRecurring ? (
          <span className="text-xs text-gray-500">✓ In Recurring bills</span>
        ) : (
          s.addable &&
          s.mark?.status !== "CANCEL" && (
            <button disabled={busy} onClick={() => onAdd(s)} className="min-h-[32px] rounded-md px-2 text-xs font-medium text-brand-700 hover:underline disabled:opacity-50">
              + Add to Recurring bills
            </button>
          )
        )}
        <button
          disabled={busy}
          onClick={() => onMark(s, "HIDDEN")}
          className="ml-auto min-h-[32px] rounded-md px-2 text-xs text-gray-500 hover:text-gray-700 hover:underline disabled:opacity-50"
          title="Hide it here: a repeating charge that isn't a subscription"
        >
          Not a subscription
        </button>
        {s.mark?.status === "CANCEL" && <span className="w-full text-xs text-gray-500">Cancel it with {s.name.split(" (")[0]}; you&apos;ll be told if it charges again.</span>}
      </div>
    </li>
  );
}

function Tile({ label, value, sub, strong }: { label: string; value: string; sub: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${strong ? "bg-ink-900 text-white" : "bg-white"}`}>
      <p className={`text-xs uppercase tracking-wide ${strong ? "text-ink-300" : "text-gray-500"}`}>{label}</p>
      <p className="font-display text-xl tabular-nums">{value}</p>
      <p className={`text-xs ${strong ? "text-ink-300" : "text-gray-500"}`}>{sub}</p>
    </div>
  );
}
