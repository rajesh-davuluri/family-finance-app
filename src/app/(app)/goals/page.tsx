"use client";

import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import { formatDate } from "@/lib/formatDate";

type Instrument = { id: string; name: string; currency: string; archived: boolean; openingBalance: string | null };
type Goal = {
  id: string;
  name: string;
  targetAmount: string;
  currency: string;
  targetDate: string | null;
  currentAmount: number | null;
  instrument: Instrument;
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({ name: "", targetAmount: "", currency: "USD", targetDate: "", instrumentId: "" });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const [goalsRes, instRes] = await Promise.all([fetch("/api/goals"), fetch("/api/instruments")]);
    setGoals(await goalsRes.json());
    const insts: Instrument[] = await instRes.json();
    setInstruments(insts.filter((i) => !i.archived));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.instrumentId) {
      setError("Pick which account this goal tracks.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        targetAmount: parseFloat(form.targetAmount),
        currency: form.currency,
        targetDate: form.targetDate || undefined,
        instrumentId: form.instrumentId,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't save that goal.");
      return;
    }
    setForm({ name: "", targetAmount: "", currency: "USD", targetDate: "", instrumentId: "" });
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this goal? The linked account and its balance are unaffected.")) return;
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Savings Goals</h1>
          <p className="text-sm text-gray-500">
            Track progress toward a target using a dedicated account's balance — set the account's opening balance
            on the Instruments page for this to work.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showForm ? "Cancel" : "Add goal"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-3">
          <input
            required
            placeholder="Goal name (e.g. Emergency Fund)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
          />
          <select
            value={form.instrumentId}
            onChange={(e) => setForm({ ...form, instrumentId: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Which account tracks this?</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="Target amount"
            value={form.targetAmount}
            onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <select
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="date"
            placeholder="Target date (optional)"
            value={form.targetDate}
            onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:col-span-3"
          >
            {submitting ? "Adding..." : "Add goal"}
          </button>
          {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
        </form>
      )}

      <div className="space-y-3">
        {goals.length === 0 && (
          <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-400">No savings goals yet.</p>
        )}
        {goals.map((g) => {
          const target = Number(g.targetAmount);
          const current = g.currentAmount ?? 0;
          const pct = Math.min(100, Math.round((current / target) * 100));
          const reached = current >= target;
          return (
            <div key={g.id} className="rounded-lg border bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{g.name}</p>
                  <p className="text-xs text-gray-500">
                    {g.instrument.name}
                    {g.targetDate && ` · Target date: ${formatDate(g.targetDate)}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-display text-lg font-semibold ${reached ? "text-income-600" : "text-gray-700"}`}>
                    {g.currency} {current.toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-400">of {g.currency} {target.toFixed(2)}</p>
                </div>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
                <div className={`h-2 rounded-full ${reached ? "bg-income-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  {g.currentAmount === null
                    ? "Set an opening balance on this account (Instruments page) to track progress."
                    : reached
                      ? "Goal reached! 🎉"
                      : `${pct}% there`}
                </p>
                <button onClick={() => handleDelete(g.id)} className="text-xs text-red-500 hover:underline">
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
