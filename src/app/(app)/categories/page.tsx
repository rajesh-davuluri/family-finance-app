"use client";

import { useEffect, useState } from "react";

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE"; isDefault: boolean };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; direction: "INCOME" | "EXPENSE" }>({
    name: "",
    direction: "EXPENSE",
  });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/categories");
    setCategories(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't add that category.");
      return;
    }
    setForm({ name: "", direction: "EXPENSE" });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this category? Only possible if no transactions use it yet.")) return;
    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "Couldn't delete — it likely has transactions.");
    }
    load();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  const income = categories.filter((c) => c.direction === "INCOME");
  const expense = categories.filter((c) => c.direction === "EXPENSE");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Categories</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border bg-white p-4 sm:flex-row">
        <input
          required
          placeholder="Category name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="flex-1 rounded-md border px-3 py-2 text-sm"
        />
        <select
          value={form.direction}
          onChange={(e) => setForm({ ...form, direction: e.target.value as "INCOME" | "EXPENSE" })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
        </select>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? "Adding..." : "Add category"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-gray-700">Income categories</h2>
          <ul className="divide-y">
            {income.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span>{c.name}</span>
                <button onClick={() => handleDelete(c.id)} className="text-xs text-red-500 hover:underline">
                  Delete
                </button>
              </li>
            ))}
            {income.length === 0 && <li className="py-2 text-sm text-gray-400">None yet.</li>}
          </ul>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-gray-700">Expense categories</h2>
          <ul className="divide-y">
            {expense.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span>{c.name}</span>
                <button onClick={() => handleDelete(c.id)} className="text-xs text-red-500 hover:underline">
                  Delete
                </button>
              </li>
            ))}
            {expense.length === 0 && <li className="py-2 text-sm text-gray-400">None yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
