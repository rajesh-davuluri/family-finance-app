"use client";

import { useEffect, useState } from "react";
import { CategoryKind, KIND_HELP, KIND_LABELS, KINDS_FOR_DIRECTION, inferKind } from "@/lib/categoryKind";
import { CATEGORY_GROUPS, CategoryGroup, GROUP_LABELS } from "@/lib/categoryGroups";

type Direction = "INCOME" | "EXPENSE";
type Category = {
  id: string;
  name: string;
  direction: Direction;
  isDefault: boolean;
  kind: CategoryKind | null;
  effectiveKind: CategoryKind;
  kindGuessed: boolean;
  effectiveGroup: CategoryGroup;
  groupGuessed: boolean;
};

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; direction: Direction; kind: CategoryKind | "" }>({
    name: "",
    direction: "EXPENSE",
    kind: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
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
      body: JSON.stringify({ name: form.name, direction: form.direction, ...(form.kind ? { kind: form.kind } : {}) }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't add that category.");
      return;
    }
    setForm({ name: "", direction: "EXPENSE", kind: "" });
    load();
  }

  async function update(c: Category, change: { kind?: CategoryKind; group?: CategoryGroup }) {
    setError(null);
    setSaving(c.id);
    const res = await fetch(`/api/categories/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    setSaving(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : `Couldn't change "${c.name}".`);
    }
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

  const groups = CATEGORY_GROUPS.map((g) => ({ group: g, items: categories.filter((c) => c.effectiveGroup === g) })).filter(
    (g) => g.items.length > 0
  );
  const guessed = categories.filter((c) => c.kindGuessed || c.groupGuessed).length;
  const formKindDefault = form.name ? inferKind(form.name, form.direction) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Categories</h1>
        <p className="text-sm text-gray-500">
          Each category&rsquo;s <strong>type</strong> decides how its transactions count everywhere — Dashboard, Paychecks
          and Reports — and its <strong>group</strong> is what it adds up to in Reports (Groceries and Dining Out both
          roll up into Food &amp; Dining).
        </p>
      </div>

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
          onChange={(e) => setForm({ ...form, direction: e.target.value as Direction, kind: "" })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="EXPENSE">Money out</option>
          <option value="INCOME">Money in</option>
        </select>
        <select
          aria-label="Type"
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value as CategoryKind | "" })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">Type: {formKindDefault ? `${KIND_LABELS[formKindDefault]} (guess)` : "guess from name"}</option>
          {KINDS_FOR_DIRECTION[form.direction].map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <List
            key={g.group}
            title={GROUP_LABELS[g.group]}
            items={g.items}
            saving={saving}
            onKind={(c, kind) => update(c, { kind })}
            onGroup={(c, group) => update(c, { group })}
            onDelete={handleDelete}
          />
        ))}
      </div>

      <div className="rounded-lg border bg-white p-4 text-sm">
        <h2 className="mb-2 font-medium text-gray-700">What the types mean</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {(Object.keys(KIND_LABELS) as CategoryKind[]).map((k) => (
            <div key={k} className="flex gap-2">
              <dt className="w-28 shrink-0 font-medium">{KIND_LABELS[k]}</dt>
              <dd className="text-gray-600">{KIND_HELP[k]}</dd>
            </div>
          ))}
        </dl>
        {guessed > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            {guessed} {guessed === 1 ? "category has" : "categories have"} a type or group guessed from the name (dashed
            border). Picking one saves it.
          </p>
        )}
      </div>
    </div>
  );
}

function List({
  title,
  items,
  saving,
  onKind,
  onGroup,
  onDelete,
}: {
  title: string;
  items: Category[];
  saving: string | null;
  onKind: (c: Category, kind: CategoryKind) => void;
  onGroup: (c: Category, group: CategoryGroup) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-2 text-sm font-medium text-gray-700">{title}</h2>
      <ul className="divide-y">
        {items.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1">
              {c.name}
              {c.direction === "INCOME" && <span className="ml-1.5 text-xs text-income-600">money in</span>}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Group of ${c.name}`}
                value={c.effectiveGroup}
                disabled={saving === c.id}
                onChange={(e) => onGroup(c, e.target.value as CategoryGroup)}
                className={`max-w-[13rem] rounded-md border px-2 py-1 text-xs ${c.groupGuessed ? "border-dashed text-gray-500" : "text-gray-800"}`}
              >
                {CATEGORY_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABELS[g]}
                    {c.groupGuessed && g === c.effectiveGroup ? " (guess)" : ""}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Type of ${c.name}`}
                value={c.effectiveKind}
                disabled={saving === c.id}
                onChange={(e) => onKind(c, e.target.value as CategoryKind)}
                title={KIND_HELP[c.effectiveKind]}
                className={`rounded-md border px-2 py-1 text-xs ${c.kindGuessed ? "border-dashed text-gray-500" : "text-gray-800"}`}
              >
                {KINDS_FOR_DIRECTION[c.direction].map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                    {c.kindGuessed && k === c.effectiveKind ? " (guess)" : ""}
                  </option>
                ))}
              </select>
              <button onClick={() => onDelete(c.id)} className="text-xs text-red-500 hover:underline">
                Delete
              </button>
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="py-2 text-sm text-gray-400">None yet.</li>}
      </ul>
    </div>
  );
}
