"use client";

import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import { Analytics } from "@vercel/analytics/next";

type Instrument = {
  id: string;
  name: string;
  type: string;
  last4: string | null;
  currency: string;
  archived: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  BANK_ACCOUNT: "Bank account",
  CREDIT_CARD: "Credit card",
  CASH: "Cash",
  OTHER: "Other",
};

export default function InstrumentsPage() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "BANK_ACCOUNT", last4: "", currency: "USD" });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/instruments");
    setInstruments(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/instruments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't add that instrument.");
      return;
    }
    setForm({ name: "", type: "BANK_ACCOUNT", last4: "", currency: "USD" });
    load();
  }

  async function toggleArchive(id: string, archived: boolean) {
    await fetch(`/api/instruments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !archived }),
    });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this instrument? Only possible if it has no transactions yet.")) return;
    const res = await fetch(`/api/instruments/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "Couldn't delete — it likely has transactions. Archive it instead.");
    }
    load();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Payment instruments</h1>
      <p className="text-sm text-gray-500">
        Bank accounts, credit cards, and cash your household tracks transactions against.
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-5">
        <input
          required
          placeholder="Name (e.g. Chase Checking)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
        />
        <select
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          placeholder="Last 4 (optional)"
          maxLength={4}
          value={form.last4}
          onChange={(e) => setForm({ ...form, last4: e.target.value })}
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
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:col-span-5"
        >
          {submitting ? "Adding..." : "Add instrument"}
        </button>
        {error && <p className="text-sm text-red-600 sm:col-span-5">{error}</p>}
      </form>

      <div className="rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="p-3">Name</th>
              <th className="p-3">Type</th>
              <th className="p-3">Last 4</th>
              <th className="p-3">Currency</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {instruments.map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="p-3">{i.name}</td>
                <td className="p-3">{TYPE_LABELS[i.type] ?? i.type}</td>
                <td className="p-3">{i.last4 || "—"}</td>
                <td className="p-3">{i.currency}</td>
                <td className="p-3">
                  <span className={i.archived ? "text-gray-400" : "text-green-600"}>
                    {i.archived ? "Archived" : "Active"}
                  </span>
                </td>
                <td className="space-x-3 p-3 text-right">
                  <button onClick={() => toggleArchive(i.id, i.archived)} className="text-xs text-brand-600 hover:underline">
                    {i.archived ? "Unarchive" : "Archive"}
                  </button>
                  <button onClick={() => handleDelete(i.id)} className="text-xs text-red-500 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {instruments.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-400">
                  No payment instruments yet — add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
