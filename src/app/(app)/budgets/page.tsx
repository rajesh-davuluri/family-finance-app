"use client";

import { useEffect, useState } from "react";

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE" };
type Budget = {
  id: string;
  monthlyLimit: string;
  spent: number;
  category: Category;
};

const MONTH_NAME = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ categoryId: "", monthlyLimit: "" });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const [budgetsRes, catsRes] = await Promise.all([fetch("/api/budgets"), fetch("/api/categories")]);
    setBudgets(await budgetsRes.json());
    const cats: Category[] = await catsRes.json();
    setCategories(cats.filter((c) => c.direction === "EXPENSE"));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.categoryId) {
      setError("Pick a category.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: form.categoryId, monthlyLimit: parseFloat(form.monthlyLimit) }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't save that budget.");
      return;
    }
    setForm({ categoryId: "", monthlyLimit: "" });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this budget?")) return;
    await fetch(`/api/budgets/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  const budgetedCategoryIds = new Set(budgets.map((b) => b.category.id));
  const availableCategories = categories.filter((c) => !budgetedCategoryIds.has(c.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Budgets</h1>
        <p className="text-sm text-gray-500">Monthly limits per category, tracked in approx. USD — {MONTH_NAME}</p>
      </div>

      {availableCategories.length > 0 && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border bg-white p-4 sm:flex-row">
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="flex-1 rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Choose a category...</option>
            {availableCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="Monthly limit ($)"
            value={form.monthlyLimit}
            onChange={(e) => setForm({ ...form, monthlyLimit: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm sm:w-48"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? "Adding..." : "Add budget"}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-expense-600">{error}</p>}

      <div className="space-y-3">
        {budgets.length === 0 && (
          <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-400">
            No budgets set yet — pick a category above to start tracking a monthly limit against it.
          </p>
        )}
        {budgets.map((b) => {
          const limit = Number(b.monthlyLimit);
          const pct = Math.min(100, Math.round((b.spent / limit) * 100));
          const over = b.spent > limit;
          const barColor = over ? "bg-expense-600" : pct >= 80 ? "bg-brand-500" : "bg-income-500";
          return (
            <div key={b.id} className="rounded-lg border bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{b.category.name}</p>
                <div className="flex items-center gap-3">
                  <p className={`font-display text-sm ${over ? "text-expense-600" : "text-gray-600"}`}>
                    ${b.spent.toFixed(2)} <span className="text-gray-400">/ ${limit.toFixed(2)}</span>
                  </p>
                  <button onClick={() => handleDelete(b.id)} className="text-xs text-red-500 hover:underline">
                    Remove
                  </button>
                </div>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
                <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {over ? `Over budget by $${(b.spent - limit).toFixed(2)}` : `${pct}% used — $${(limit - b.spent).toFixed(2)} remaining`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
