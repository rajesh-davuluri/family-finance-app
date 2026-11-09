"use client";

import { useEffect, useRef, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import { money } from "@/lib/money";
import { categoryHint, type ReceiptGuess } from "@/lib/receiptParse";
import { parseReceiptItems, type ReceiptItem } from "@/lib/receiptItems";
import SplitEditor, { type SplitValue } from "@/components/SplitEditor";

type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE" };
type Instrument = { id: string; name: string; currency: string; archived: boolean };
type DuplicateInfo = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  notes: string | null;
  categoryName: string;
  instrumentName: string;
  source: string;
  reason: string;
};
const SOURCE_WORDS: Record<string, string> = {
  IMPORTED: "imported from a statement",
  EMAIL: "from an email alert",
  TELEGRAM: "sent from Telegram",
  RECURRING: "from a recurring template",
  MANUAL: "added by hand",
};

export type EditableTransaction = {
  id: string;
  amount: string | number;
  currency: string;
  date: string;
  notes: string | null;
  categoryId: string;
  instrumentId: string;
  hasPhoto?: boolean;
  // When this is one part of a bill split by category: the whole charge.
  splitTotal?: number;
  splitParts?: number;
};

const SCAN_STAGE: Record<string, string> = {
  preparing: "Preparing the photo…",
  loading: "Getting the reader ready (first time takes a few seconds)…",
  reading: "Reading the bill…",
};

export default function AddTransactionModal({
  open,
  onClose,
  onSuccess,
  editingTransaction,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // When editing, offers a Delete button (on a phone the transaction list
  // has no row buttons: tapping a transaction opens it here).
  onDelete?: (id: string) => void;
  // When provided, the modal edits this transaction (PATCH) instead of
  // creating a new one (POST). Everything else about the form is identical.
  editingTransaction?: EditableTransaction | null;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // An existing transaction this one looks like a copy of (from the server's duplicate check).
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    amount: "",
    currency: "USD",
    date: getTodayLocal(),
    notes: "",
    categoryId: "",
    instrumentId: "",
  });

  const isEditing = !!editingTransaction;

  // The bill photo: a new one to upload on save (with a preview), or the one
  // already stored for the transaction being edited.
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [hasStoredPhoto, setHasStoredPhoto] = useState(false);
  const [removeStoredPhoto, setRemoveStoredPhoto] = useState(false);
  const [scan, setScan] = useState<{ stage: string; fraction: number } | null>(null);
  const [scanNote, setScanNote] = useState<{ ok: boolean; text: string } | null>(null);
  // Receipt items for splitting the bill by category, and what the split is.
  const [receiptItems, setReceiptItems] = useState<{ items: ReceiptItem[]; rules: Record<string, string>; n: number } | null>(null);
  const [split, setSplit] = useState<SplitValue | null>(null);
  const pickFor = useRef<"attach" | "split">("attach");

  async function showItems(text: string) {
    const items = parseReceiptItems(text);
    if (items.length < 2) return false;
    let rules: Record<string, string> = {};
    try {
      const r = await fetch("/api/transactions/item-rules");
      if (r.ok) rules = (await r.json()).rules ?? {};
    } catch {
      /* guess from item names alone */
    }
    setSplit(null);
    setReceiptItems((old) => ({ items, rules, n: (old?.n ?? 0) + 1 }));
    return true;
  }

  function setNewPhoto(b: Blob | null) {
    setPhoto(b);
    setPhotoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return b ? URL.createObjectURL(b) : null;
    });
  }

  // Take or choose a photo. A new transaction is filled in from what's read;
  // when editing, the photo is only attached.
  async function onPhotoPicked(file: File | undefined) {
    if (!file) return;
    setError(null);
    setScanNote(null);
    if (isEditing && pickFor.current === "split") {
      // Read an existing charge's receipt to split it by category.
      try {
        const { scanBill } = await import("@/lib/billScan");
        setScan({ stage: "preparing", fraction: 0 });
        const result = await scanBill(file, getTodayLocal(), (stage, fraction) => setScan({ stage, fraction }));
        setNewPhoto(result.photo);
        setRemoveStoredPhoto(false);
        const found = await showItems(result.text);
        setScanNote(
          found
            ? { ok: true, text: "Items read from the receipt — check how they're split below." }
            : { ok: false, text: "Couldn't make out the items on this receipt. The photo will still be saved." },
        );
      } catch {
        setError("Couldn't read that photo.");
      } finally {
        setScan(null);
      }
      return;
    }
    if (isEditing) {
      try {
        const { shrinkPhoto } = await import("@/lib/billScan");
        setNewPhoto(await shrinkPhoto(file));
        setRemoveStoredPhoto(false);
      } catch {
        setError("Couldn't open that photo.");
      }
      return;
    }
    try {
      const { scanBill } = await import("@/lib/billScan");
      setScan({ stage: "preparing", fraction: 0 });
      const result = await scanBill(file, getTodayLocal(), (stage, fraction) => setScan({ stage, fraction }));
      setNewPhoto(result.photo);
      await applyGuess(result.guess, result.text);
      await showItems(result.text);
    } catch (e) {
      // Keep the photo even when it can't be read.
      try {
        const { shrinkPhoto } = await import("@/lib/billScan");
        setNewPhoto(await shrinkPhoto(file));
      } catch {
        /* the photo itself couldn't be opened */
      }
      setScanNote({ ok: false, text: `Couldn't read the bill${e instanceof Error && e.message ? ` (${e.message})` : ""}. Type the details in — the photo will still be saved.` });
    } finally {
      setScan(null);
    }
  }

  async function applyGuess(g: ReceiptGuess, text: string) {
    const next = { ...form };
    if (g.amount != null) next.amount = g.amount.toFixed(2);
    if (g.date) next.date = g.date;
    if (g.merchant && !next.notes) next.notes = g.merchant;
    // Rupees on the bill: pay from a rupee account if there is one.
    if (g.currency && g.currency !== next.currency) {
      const inCurrency = instruments.find((i) => !i.archived && i.currency === g.currency);
      next.currency = g.currency;
      if (inCurrency) next.instrumentId = inCurrency.id;
    }
    // The category used for this store before; failing that, one whose name
    // fits what the bill is for (groceries, dining, fuel...).
    let fromHistory = false;
    if (g.merchant) {
      try {
        const res = await fetch("/api/transactions/bulk/suggest-categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ descriptions: [g.merchant] }),
        });
        const id = res.ok ? (await res.json()).suggestions?.[0]?.categoryId : null;
        if (id && categories.some((c) => c.id === id)) {
          next.categoryId = id;
          fromHistory = true;
        }
      } catch {
        /* keep the current category */
      }
    }
    if (!fromHistory) {
      const expense = categories.filter((c) => c.direction === "EXPENSE");
      const byName = (categoryHint(text) ?? []).map((re) => expense.find((c) => re.test(c.name))).find(Boolean);
      if (byName) next.categoryId = byName.id;
    }
    setForm(next);
    const found = [g.merchant, g.amount != null ? money(g.amount, next.currency) : null, g.date ? formatDate(g.date, { month: "short", day: "numeric" }) : null].filter(Boolean);
    setScanNote(
      g.amount == null
        ? { ok: false, text: `Couldn't find the total${found.length ? ` (read: ${found.join(" · ")})` : ""} — type the amount in.` }
        : { ok: true, text: `Read from the bill: ${found.join(" · ")}. Check it before saving.` },
    );
  }

  async function savePhoto(transactionId: string): Promise<string | null> {
    try {
      if (photo) {
        const res = await fetch(`/api/transactions/${transactionId}/attachment`, { method: "PUT", headers: { "Content-Type": photo.type || "image/jpeg" }, body: photo });
        if (!res.ok) return (await res.json().catch(() => null))?.error ?? "the photo didn't upload";
      } else if (removeStoredPhoto) {
        await fetch(`/api/transactions/${transactionId}/attachment`, { method: "DELETE" });
      }
      return null;
    } catch {
      return "the photo didn't upload (no connection)";
    }
  }

  // Load fresh options each time the modal opens, in case a category or
  // instrument was added/archived since the last time it was open. Prefills
  // from editingTransaction when editing, otherwise defaults to sensible
  // first options for a new transaction.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDuplicate(null);
    setLoading(true);
    setNewPhoto(null);
    setScan(null);
    setScanNote(null);
    setRemoveStoredPhoto(false);
    setHasStoredPhoto(!!editingTransaction?.hasPhoto);
    setReceiptItems(null);
    setSplit(null);
    pickFor.current = "attach";
    Promise.all([fetch("/api/categories"), fetch("/api/instruments")]).then(async ([catRes, instRes]) => {
      const cats = await catRes.json();
      const insts = await instRes.json();
      setCategories(cats);
      setInstruments(insts);
      if (editingTransaction) {
        setForm({
          amount: String(editingTransaction.amount),
          currency: editingTransaction.currency,
          date: editingTransaction.date.slice(0, 10),
          notes: editingTransaction.notes ?? "",
          categoryId: editingTransaction.categoryId,
          instrumentId: editingTransaction.instrumentId,
        });
      } else {
        const first = insts.find((i: Instrument) => !i.archived);
        setForm((f) => ({
          ...f,
          categoryId: cats[0]?.id || "",
          instrumentId: first?.id || "",
          currency: first?.currency || f.currency,
        }));
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingTransaction?.id]);

  async function handleSubmit(e: React.FormEvent, allowDuplicate = false) {
    e.preventDefault();
    // "Add anyway" after the warning: the transaction it looked like.
    const notDuplicateOf = allowDuplicate ? duplicate?.id : undefined;
    setError(null);
    setDuplicate(null);
    if (!form.categoryId || !form.instrumentId) {
      setError("Add a category and a payment instrument first (see the Categories / Instruments pages).");
      return;
    }
    setSubmitting(true);
    if (split?.enabled && split.parts.length > 0) {
      await submitSplit(allowDuplicate, notDuplicateOf);
      return;
    }
    const res = await fetch(isEditing ? `/api/transactions/${editingTransaction!.id}` : "/api/transactions", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        amount: parseFloat(form.amount),
        ...(allowDuplicate ? { allowDuplicate: true, notDuplicateOf } : {}),
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      if (res.status === 409 && body.duplicate) {
        setDuplicate(body.duplicate);
        return;
      }
      setError(
        typeof body.error === "string" ? body.error : `Couldn't ${isEditing ? "save" : "add"} that transaction.`,
      );
      return;
    }
    const saved = await res.json().catch(() => null);
    const photoError = saved?.id ? await savePhoto(saved.id) : null;
    if (photoError) window.alert(`The transaction was saved, but ${photoError}. Open it and attach the photo again.`);
    if (!isEditing) setForm((f) => ({ ...f, amount: "", notes: "" }));
    setNewPhoto(null);
    setScanNote(null);
    setDuplicate(null);
    onSuccess();
  }

  // Save the bill split by category: a new bill, or this transaction split.
  async function submitSplit(allowDuplicate: boolean, notDuplicateOf?: string) {
    if (isEditing) {
      // Date, account or note changes first; the split copies them to every part.
      const patch = await fetch(`/api/transactions/${editingTransaction!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      if (!patch.ok) {
        setSubmitting(false);
        setError("Couldn't save the changes.");
        return;
      }
    }
    const res = await fetch("/api/transactions/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(isEditing ? { transactionId: editingTransaction!.id } : {}),
        date: form.date,
        instrumentId: form.instrumentId,
        currency: form.currency,
        notes: form.notes || null,
        parts: split!.parts,
        items: split!.items,
        ...(allowDuplicate ? { allowDuplicate: true, notDuplicateOf } : {}),
      }),
    });
    setSubmitting(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 409 && body?.duplicate) return setDuplicate(body.duplicate);
      return setError(typeof body?.error === "string" ? body.error : "Couldn't save the split.");
    }
    const photoError = body?.primaryId ? await savePhoto(body.primaryId) : null;
    if (photoError) window.alert(`The bill was saved, but ${photoError}. Open it and attach the photo again.`);
    if (!isEditing) setForm((f) => ({ ...f, amount: "", notes: "" }));
    setNewPhoto(null);
    setScanNote(null);
    setReceiptItems(null);
    setSplit(null);
    setDuplicate(null);
    onSuccess();
  }

  if (!open) return null;

  const splitOn = !!split?.enabled && split.parts.length > 0;
  const isExpense = categories.find((c) => c.id === form.categoryId)?.direction !== "INCOME";
  const splitTotal = isEditing ? editingTransaction?.splitTotal ?? Number(editingTransaction?.amount ?? 0) : parseFloat(form.amount) || 0;

  const noSetupYet = !loading && (categories.length === 0 || instruments.length === 0);

  return (
    // A sheet from the bottom on a phone (within thumb reach), a centred dialog on wider screens.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg sm:rounded-lg sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 sm:hidden" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEditing ? "Edit Transaction" : "Add Transaction"}</h2>
          <button onClick={onClose} className="-mr-2 flex h-10 w-10 items-center justify-center text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <>
            {noSetupYet && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                You need at least one category and one payment instrument before adding transactions — set those up
                on the Categories / Instruments pages first.
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onPhotoPicked(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {!noSetupYet && (
              <div className="mb-3 space-y-2">
                {!isEditing && !photoUrl && !scan && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-brand-400 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700 active:bg-brand-100"
                  >
                    <span aria-hidden>📷</span> Scan a bill or receipt
                  </button>
                )}
                {scan && (
                  <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600" role="status">
                    <p>{SCAN_STAGE[scan.stage]}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className={`h-full rounded-full bg-brand-500 transition-all ${scan.stage === "loading" ? "w-1/3 animate-pulse" : ""}`}
                        style={scan.stage === "reading" ? { width: `${Math.max(8, Math.round(scan.fraction * 100))}%` } : undefined}
                      />
                    </div>
                  </div>
                )}
                {(photoUrl || (hasStoredPhoto && !removeStoredPhoto)) && (
                  <div className="flex items-start gap-3 rounded-md border p-2">
                    <a
                      href={photoUrl ?? `/api/transactions/${editingTransaction?.id}/attachment`}
                      target="_blank"
                      rel="noopener"
                      className="shrink-0"
                      title="Open the photo"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoUrl ?? `/api/transactions/${editingTransaction?.id}/attachment`}
                        alt="Bill photo"
                        className="h-16 w-16 rounded object-cover"
                      />
                    </a>
                    <div className="min-w-0 flex-1 text-sm">
                      {scanNote ? (
                        <p className={scanNote.ok ? "text-gray-700" : "text-amber-800"}>{scanNote.text}</p>
                      ) : (
                        <p className="text-gray-600">{photoUrl ? "New photo — saved with the transaction." : "Bill photo"}</p>
                      )}
                      <div className="mt-1 flex gap-3 text-xs">
                        <button type="button" onClick={() => fileRef.current?.click()} className="text-brand-700 underline">
                          {isEditing ? "Replace" : "Scan another"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNewPhoto(null);
                            setScanNote(null);
                            if (hasStoredPhoto) setRemoveStoredPhoto(true);
                          }}
                          className="text-red-600 underline"
                        >
                          Remove photo
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {!photoUrl && scanNote && !scanNote.ok && <p className="text-sm text-amber-800">{scanNote.text}</p>}
                {isEditing && !photoUrl && !scan && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {isExpense && !receiptItems && (
                      <button
                        type="button"
                        onClick={() => {
                          pickFor.current = "split";
                          fileRef.current?.click();
                        }}
                        className="text-brand-700 underline"
                      >
                        🧾 Scan the receipt to split by category
                      </button>
                    )}
                    {(!hasStoredPhoto || removeStoredPhoto) && (
                      <button
                        type="button"
                        onClick={() => {
                          pickFor.current = "attach";
                          fileRef.current?.click();
                        }}
                        className="text-brand-700 underline"
                      >
                        📷 Attach a bill photo
                      </button>
                    )}
                  </div>
                )}
                {isEditing && (editingTransaction?.splitParts ?? 0) > 1 && !receiptItems && (
                  <p className="text-xs text-gray-500">
                    One of {editingTransaction!.splitParts} parts of a {money(editingTransaction!.splitTotal ?? 0, editingTransaction!.currency)} bill split by
                    category.
                  </p>
                )}
                {receiptItems && (
                  <SplitEditor
                    key={receiptItems.n}
                    items={receiptItems.items}
                    rules={receiptItems.rules}
                    categories={categories}
                    total={splitTotal}
                    currency={form.currency}
                    onChange={setSplit}
                  />
                )}
              </div>
            )}
            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                // Straight to the amount with a keyboard; on a touch screen the keyboard would cover the Scan button.
                autoFocus={!isEditing && typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
                placeholder="Amount"
                aria-label="Amount"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="rounded-md border px-3 py-3 text-2xl font-semibold tabular-nums sm:py-2 sm:text-sm sm:font-normal"
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
              {splitOn && (
                <p className="rounded-md border border-dashed px-3 py-2 text-sm text-gray-600 sm:col-span-2">
                  Category: split across {split!.parts.length} (above)
                </p>
              )}
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className={`rounded-md border px-3 py-2 text-sm sm:col-span-2 ${splitOn ? "hidden" : ""}`}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.direction === "INCOME" ? "Income" : "Expense"})
                  </option>
                ))}
              </select>
              <select
                value={form.instrumentId}
                onChange={(e) => {
                  // A rupee account means rupees: follow the account's currency.
                  const inst = instruments.find((i) => i.id === e.target.value);
                  setForm({ ...form, instrumentId: e.target.value, currency: inst?.currency ?? form.currency });
                }}
                className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
              >
                {instruments
                  .filter((i) => !i.archived || i.id === editingTransaction?.instrumentId)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.archived ? " (archived)" : ""}
                    </option>
                  ))}
              </select>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="rounded-md border px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Notes (optional)"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="rounded-md border px-3 py-2 text-sm"
              />
              {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
              {duplicate && (
                <div
                  className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2"
                  role="alert"
                >
                  <p className="font-medium">This looks like it&rsquo;s already recorded:</p>
                  <p className="mt-1">
                    {formatDate(duplicate.date)} · {money(duplicate.amount, duplicate.currency)}
                    {duplicate.notes ? ` · “${duplicate.notes}”` : ""} · {duplicate.categoryName} ·{" "}
                    {duplicate.instrumentName}
                    {SOURCE_WORDS[duplicate.source] ? ` (${SOURCE_WORDS[duplicate.source]})` : ""}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">{duplicate.reason}.</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={(e) => handleSubmit(e as unknown as React.FormEvent, true)}
                      className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs hover:bg-amber-100"
                    >
                      Add anyway
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-md px-3 py-1 text-xs text-amber-900 hover:underline"
                    >
                      Don&rsquo;t add
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-2 sm:col-span-2">
                {isEditing && onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(editingTransaction!.id)}
                    className="mr-auto rounded-md px-2 py-2.5 text-sm text-red-600 hover:underline sm:py-2"
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 sm:py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || noSetupYet || !!scan}
                  className="flex-1 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:flex-none sm:py-2"
                >
                  {submitting ? "Saving..." : splitOn ? `Save as ${split!.parts.length} parts` : isEditing ? "Save Changes" : "Add Transaction"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
