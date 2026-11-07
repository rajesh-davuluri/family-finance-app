"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CURRENCIES } from "@/lib/enums";
import { formatDate, getTodayLocal } from "@/lib/formatDate";
import {
  FREQUENCY_LABELS,
  MAX_DOCUMENT_BYTES,
  POLICY_KINDS,
  POLICY_KIND_LABELS,
  POLICY_STATUSES,
  POLICY_STATUS_LABELS,
  PREMIUM_FREQUENCIES,
  annualPremium,
  daysBetween,
  graceDays,
  summarize,
  type PolicyKind,
  type PolicyStatus,
  type PremiumFrequency,
} from "@/lib/policies";

// Everything about the household's insurance policies in one place: the
// policy itself, the people on it, premiums (with every payment made),
// agent and helpline, where the login is kept, documents, and any other
// detail as label/value pairs.

type Extra = { label: string; value: string };
type Payment = {
  id: string;
  amount: number;
  currency: string;
  date: string;
  notes: string | null;
  instrument: { name: string };
};
type Doc = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
};
type Policy = {
  id: string;
  kind: PolicyKind;
  status: PolicyStatus;
  insurer: string;
  planName: string | null;
  policyNumber: string | null;
  insuredPerson: string | null;
  nominee: string | null;
  currency: string;
  sumAssured: number | null;
  maturityAmount: number | null;
  premiumAmount: number | null;
  premiumFrequency: PremiumFrequency | null;
  nextDueDate: string | null;
  premiumEndDate: string | null;
  startDate: string | null;
  endDate: string | null;
  agentName: string | null;
  agentPhone: string | null;
  helpline: string | null;
  website: string | null;
  loginNote: string | null;
  notes: string | null;
  extraFields: Extra[];
  payments: Payment[];
  documents: Doc[];
};
type Instrument = {
  id: string;
  name: string;
  currency: string;
  archived: boolean;
  type: string;
};
type Category = {
  id: string;
  name: string;
  direction: string;
  effectiveKind?: string;
};

const money = (currency: string, n: number) => {
  const cents = Math.round(n * 100) % 100 !== 0;
  return `${currency} ${n.toLocaleString(currency === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`;
};

const input = "w-full rounded-md border px-3 py-2 text-sm";

type FormState = {
  kind: PolicyKind;
  status: PolicyStatus;
  insurer: string;
  planName: string;
  policyNumber: string;
  insuredPerson: string;
  nominee: string;
  currency: string;
  sumAssured: string;
  maturityAmount: string;
  premiumAmount: string;
  premiumFrequency: string;
  nextDueDate: string;
  premiumEndDate: string;
  startDate: string;
  endDate: string;
  agentName: string;
  agentPhone: string;
  helpline: string;
  website: string;
  loginNote: string;
  notes: string;
  extraFields: Extra[];
};

const EMPTY: FormState = {
  kind: "LIFE",
  status: "ACTIVE",
  insurer: "LIC of India",
  planName: "",
  policyNumber: "",
  insuredPerson: "",
  nominee: "",
  currency: "INR",
  sumAssured: "",
  maturityAmount: "",
  premiumAmount: "",
  premiumFrequency: "YEARLY",
  nextDueDate: "",
  premiumEndDate: "",
  startDate: "",
  endDate: "",
  agentName: "",
  agentPhone: "",
  helpline: "",
  website: "",
  loginNote: "",
  notes: "",
  extraFields: [],
};

function toForm(p: Policy): FormState {
  const s = (v: string | null) => v ?? "";
  const n = (v: number | null) => (v === null ? "" : String(v));
  return {
    kind: p.kind,
    status: p.status,
    insurer: p.insurer,
    planName: s(p.planName),
    policyNumber: s(p.policyNumber),
    insuredPerson: s(p.insuredPerson),
    nominee: s(p.nominee),
    currency: p.currency,
    sumAssured: n(p.sumAssured),
    maturityAmount: n(p.maturityAmount),
    premiumAmount: n(p.premiumAmount),
    premiumFrequency: s(p.premiumFrequency),
    nextDueDate: s(p.nextDueDate),
    premiumEndDate: s(p.premiumEndDate),
    startDate: s(p.startDate),
    endDate: s(p.endDate),
    agentName: s(p.agentName),
    agentPhone: s(p.agentPhone),
    helpline: s(p.helpline),
    website: s(p.website),
    loginNote: s(p.loginNote),
    notes: s(p.notes),
    extraFields: p.extraFields.length ? p.extraFields : [],
  };
}

function fromForm(f: FormState) {
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const str = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    kind: f.kind,
    status: f.status,
    insurer: f.insurer.trim(),
    planName: str(f.planName),
    policyNumber: str(f.policyNumber),
    insuredPerson: str(f.insuredPerson),
    nominee: str(f.nominee),
    currency: f.currency,
    sumAssured: num(f.sumAssured),
    maturityAmount: num(f.maturityAmount),
    premiumAmount: num(f.premiumAmount),
    premiumFrequency: f.premiumFrequency || null,
    nextDueDate: str(f.nextDueDate),
    premiumEndDate: str(f.premiumEndDate),
    startDate: str(f.startDate),
    endDate: str(f.endDate),
    agentName: str(f.agentName),
    agentPhone: str(f.agentPhone),
    helpline: str(f.helpline),
    website: str(f.website),
    loginNote: str(f.loginNote),
    notes: str(f.notes),
    extraFields: f.extraFields.filter((x) => x.label.trim() && x.value.trim()),
  };
}

function errorText(body: { error?: unknown }, fallback: string) {
  if (typeof body.error === "string") return body.error;
  const e = body.error as { fieldErrors?: Record<string, string[]> } | undefined;
  const first = e?.fieldErrors && Object.entries(e.fieldErrors)[0];
  return first ? `${first[0]}: ${first[1][0]}` : fallback;
}

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Policy | "new" | null>(null);
  const [paying, setPaying] = useState<Policy | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  async function load() {
    const [p, i, c] = await Promise.all([fetch("/api/policies"), fetch("/api/instruments"), fetch("/api/categories")]);
    if (p.ok) setPolicies(await p.json());
    if (i.ok) setInstruments(((await i.json()) as Instrument[]).filter((x) => !x.archived));
    if (c.ok) setCategories(((await c.json()) as Category[]).filter((x) => x.direction === "EXPENSE"));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function replace(updated: Policy) {
    setPolicies((ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
  }

  const today = getTodayLocal();
  const { cover, yearly } = useMemo(() => summarize(policies), [policies]);
  const upcoming = policies
    .filter((p) => p.status === "ACTIVE" && p.nextDueDate)
    .sort((a, b) => a.nextDueDate!.localeCompare(b.nextDueDate!))[0];
  const order = (p: Policy) => (p.status === "ACTIVE" ? 0 : p.status === "PAID_UP" ? 1 : 2);
  const sorted = [...policies].sort(
    (a, b) => order(a) - order(b) || (a.nextDueDate ?? "9999").localeCompare(b.nextDueDate ?? "9999") || a.insurer.localeCompare(b.insurer),
  );

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Insurance policies</h1>
          <p className="text-sm text-gray-500">
            Everything about each policy in one place: numbers, people, premiums and what you&apos;ve paid, agent and helpline, where the
            login is kept, and the documents.
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Add policy
        </button>
      </div>

      {policies.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile label="Life cover (life + term)">
            {Object.keys(cover).length ? Object.entries(cover).map(([c, n]) => <div key={c}>{money(c, n)}</div>) : "—"}
          </Tile>
          <Tile label="Premiums per year">
            {Object.keys(yearly).length ? Object.entries(yearly).map(([c, n]) => <div key={c}>{money(c, n)}</div>) : "—"}
          </Tile>
          <Tile label="Next premium">
            {upcoming ? (
              <>
                <div>
                  {upcoming.premiumAmount !== null ? money(upcoming.currency, upcoming.premiumAmount) : "—"}{" "}
                  <span className="text-sm font-normal text-gray-500">· {formatDate(upcoming.nextDueDate!)}</span>
                </div>
                <div className="text-xs font-normal text-gray-500">
                  {upcoming.insurer}
                  {upcoming.planName ? ` ${upcoming.planName}` : ""}
                </div>
              </>
            ) : (
              "—"
            )}
          </Tile>
        </div>
      )}

      {sorted.length === 0 && (
        <div className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
          No policies yet. Add your LIC and term policies to keep their details, premiums and documents together, with a reminder before
          each premium is due.
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((p) => (
          <PolicyCard
            key={p.id}
            policy={p}
            today={today}
            open={!!open[p.id]}
            onToggle={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
            onEdit={() => setEditing(p)}
            onPay={() => setPaying(p)}
            onChanged={replace}
            onReload={load}
          />
        ))}
      </div>

      <p className="text-xs text-gray-400">
        Passwords aren&apos;t stored here. Keep them in a password manager (Bitwarden, 1Password) and note where under &quot;Login&quot;.
        You&apos;ll get a reminder (here and on Telegram, if linked) 15, 7 and 2 days before a premium is due and on the day.
      </p>

      {editing && (
        <PolicyForm
          policy={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            setEditing(null);
            if (isNew) {
              setPolicies((ps) => [...ps, saved]);
              setOpen((o) => ({ ...o, [saved.id]: true }));
            } else replace(saved);
          }}
          onDeleted={(id) => {
            setEditing(null);
            setPolicies((ps) => ps.filter((p) => p.id !== id));
          }}
        />
      )}

      {paying && (
        <PayDialog
          policy={paying}
          instruments={instruments}
          categories={categories}
          onClose={() => setPaying(null)}
          onPaid={(updated) => {
            setPaying(null);
            replace(updated);
            setOpen((o) => ({ ...o, [updated.id]: true }));
          }}
          onCategoryCreated={(c) => setCategories((cs) => [...cs, c])}
        />
      )}
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <div className="font-display mt-1 text-lg font-semibold text-gray-800">{children}</div>
    </div>
  );
}

function DueBadge({ policy, today }: { policy: Policy; today: string }) {
  if (policy.status !== "ACTIVE" || !policy.nextDueDate) return null;
  const days = daysBetween(today, policy.nextDueDate);
  const grace = graceDays(policy.premiumFrequency);
  const [text, tone] =
    days < -grace
      ? [`Overdue ${-days} days — past the grace period`, "bg-red-100 text-red-700"]
      : days < 0
        ? [`Overdue ${-days} day${days === -1 ? "" : "s"} · ${grace + days} days of grace left`, "bg-red-100 text-red-700"]
        : days === 0
          ? ["Due today", "bg-amber-100 text-amber-800"]
          : days <= 15
            ? [`Due in ${days} day${days === 1 ? "" : "s"}`, "bg-amber-100 text-amber-800"]
            : [`Due ${formatDate(policy.nextDueDate)}`, "bg-gray-100 text-gray-600"];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{text}</span>;
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="ml-1 text-xs text-brand-600 hover:underline"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

function Field({ label, value, copy, href }: { label: string; value: React.ReactNode; copy?: string; href?: string }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-2 py-1 text-sm">
      <dt className="w-36 shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-gray-800">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
            {value}
          </a>
        ) : (
          value
        )}
        {copy && <CopyButton value={copy} />}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      <dl>{children}</dl>
    </div>
  );
}

const url = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);

function PolicyCard({
  policy: p,
  today,
  open,
  onToggle,
  onEdit,
  onPay,
  onChanged,
  onReload,
}: {
  policy: Policy;
  today: string;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPay: () => void;
  onChanged: (p: Policy) => void;
  onReload: () => void;
}) {
  const inactive = p.status !== "ACTIVE" && p.status !== "PAID_UP";
  const paidTotal = p.payments.reduce<Record<string, number>>(
    (acc, t) => ({ ...acc, [t.currency]: (acc[t.currency] ?? 0) + t.amount }),
    {},
  );
  return (
    <div className={`rounded-lg border bg-white ${inactive ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <button onClick={onToggle} className="min-w-0 basis-full text-left sm:basis-0 sm:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {p.insurer}
              {p.planName ? ` · ${p.planName}` : ""}
            </span>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{POLICY_KIND_LABELS[p.kind]}</span>
            {p.status !== "ACTIVE" && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{POLICY_STATUS_LABELS[p.status]}</span>
            )}
            <DueBadge policy={p} today={today} />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {[
              p.policyNumber && `Policy ${p.policyNumber}`,
              p.insuredPerson && `Insured: ${p.insuredPerson}`,
              p.sumAssured !== null && `Cover ${money(p.currency, p.sumAssured)}`,
              p.premiumAmount !== null &&
                `${money(p.currency, p.premiumAmount)} ${p.premiumFrequency ? FREQUENCY_LABELS[p.premiumFrequency].toLowerCase() : ""}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </button>
        <div className="flex items-center gap-3">
          {p.status === "ACTIVE" && p.premiumAmount !== null && (
            <button onClick={onPay} className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700">
              Pay premium
            </button>
          )}
          <button onClick={onEdit} className="text-xs text-brand-600 hover:underline">
            Edit
          </button>
          <button onClick={onToggle} className="text-xs text-gray-500 hover:underline">
            {open ? "Hide" : "Details"}
          </button>
        </div>
      </div>

      {open && (
        <div className="grid grid-cols-1 gap-5 border-t p-4 md:grid-cols-2">
          <Section title="Policy">
            <Field label="Insurer" value={p.insurer} />
            <Field label="Plan" value={p.planName} />
            <Field label="Policy number" value={p.policyNumber} copy={p.policyNumber ?? undefined} />
            <Field label="Type" value={POLICY_KIND_LABELS[p.kind]} />
            <Field label="Status" value={POLICY_STATUS_LABELS[p.status]} />
            <Field label="Sum assured" value={p.sumAssured !== null ? money(p.currency, p.sumAssured) : null} />
            <Field label="Maturity amount" value={p.maturityAmount !== null ? money(p.currency, p.maturityAmount) : null} />
            <Field label="Start date" value={p.startDate && formatDate(p.startDate)} />
            <Field label={p.kind === "TERM" ? "Cover ends" : "Maturity date"} value={p.endDate && formatDate(p.endDate)} />
          </Section>

          <Section title="People">
            <Field label="Insured" value={p.insuredPerson} />
            <Field label="Nominee" value={p.nominee} />
            <Field label="Agent" value={p.agentName} />
            <Field label="Agent phone" value={p.agentPhone} href={p.agentPhone ? `tel:${p.agentPhone}` : undefined} />
            <Field label="Helpline" value={p.helpline} href={p.helpline ? `tel:${p.helpline}` : undefined} />
            <Field label="Website" value={p.website} href={p.website ? url(p.website) : undefined} />
            <Field label="Login" value={p.loginNote} />
            {!p.insuredPerson && !p.nominee && !p.agentName && !p.helpline && !p.website && !p.loginNote && (
              <p className="text-sm text-gray-400">Nothing yet. Use Edit to add them.</p>
            )}
          </Section>

          <Section title="Premiums">
            <Field label="Premium" value={p.premiumAmount !== null ? money(p.currency, p.premiumAmount) : null} />
            <Field label="How often" value={p.premiumFrequency && FREQUENCY_LABELS[p.premiumFrequency]} />
            <Field
              label="Per year"
              value={
                p.premiumAmount !== null && annualPremium(p.premiumAmount, p.premiumFrequency)
                  ? money(p.currency, annualPremium(p.premiumAmount, p.premiumFrequency))
                  : null
              }
            />
            <Field label="Next due" value={p.nextDueDate && formatDate(p.nextDueDate)} />
            <Field label="Last premium" value={p.premiumEndDate && formatDate(p.premiumEndDate)} />
            <Field
              label="Paid so far"
              value={
                Object.keys(paidTotal).length
                  ? Object.entries(paidTotal)
                      .map(([c, n]) => money(c, n))
                      .join(" + ")
                  : null
              }
            />
          </Section>

          {(p.extraFields.length > 0 || p.notes) && (
            <Section title="Other details">
              {p.extraFields.map((x, i) => (
                <Field key={i} label={x.label} value={x.value} />
              ))}
              {p.notes && <p className="whitespace-pre-wrap py-1 text-sm text-gray-700">{p.notes}</p>}
            </Section>
          )}

          <div className="md:col-span-2">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Premiums paid</h3>
            {p.payments.length === 0 ? (
              <p className="text-sm text-gray-400">None recorded yet. &quot;Pay premium&quot; records one here and in Transactions.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {p.payments.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 text-gray-600">{formatDate(t.date)}</td>
                      <td className="py-1.5 pr-3">{money(t.currency, t.amount)}</td>
                      <td className="py-1.5 text-gray-500">from {t.instrument.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <Documents policy={p} onChanged={onChanged} onReload={onReload} />
        </div>
      )}
    </div>
  );
}

function Documents({ policy, onChanged, onReload }: { policy: Policy; onChanged: (p: Policy) => void; onReload: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    const added: Doc[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_DOCUMENT_BYTES) {
        setError(`${file.name} is over 4 MB.`);
        continue;
      }
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/policies/${policy.id}/documents`, {
        method: "POST",
        body,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(errorText(json, `Couldn't upload ${file.name}.`));
      else added.push(json);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (added.length) onChanged({ ...policy, documents: [...added, ...policy.documents] });
  }

  async function remove(d: Doc) {
    if (!confirm(`Delete ${d.fileName}?`)) return;
    const res = await fetch(`/api/policies/${policy.id}/documents/${d.id}`, {
      method: "DELETE",
    });
    if (res.ok)
      onChanged({
        ...policy,
        documents: policy.documents.filter((x) => x.id !== d.id),
      });
    else onReload();
  }

  return (
    <div className="md:col-span-2">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Documents</h3>
        <label className="cursor-pointer text-xs text-brand-600 hover:underline">
          {busy ? "Uploading..." : "Upload PDF or photo"}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
            className="hidden"
            disabled={busy}
            onChange={(e) => upload(e.target.files)}
          />
        </label>
      </div>
      {policy.documents.length === 0 ? (
        <p className="text-sm text-gray-400">The policy bond, premium receipts, nominee form... (up to 4 MB each).</p>
      ) : (
        <ul className="space-y-1">
          {policy.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-sm">
              <a
                href={`/api/policies/${policy.id}/documents/${d.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-brand-600 hover:underline"
              >
                {d.fileName}
              </a>
              <span className="ml-3 flex shrink-0 items-center gap-3 text-xs text-gray-400">
                {(d.size / 1024).toFixed(0)} KB · {formatDate(d.createdAt)}
                <button onClick={() => remove(d)} className="text-red-500 hover:underline">
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-lg bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-600" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function L({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block text-xs text-gray-500 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function PolicyForm({
  policy,
  onClose,
  onSaved,
  onDeleted,
}: {
  policy: Policy | null;
  onClose: () => void;
  onSaved: (p: Policy, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [f, setF] = useState<FormState>(policy ? toForm(policy) : EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const bind = (k: keyof FormState) => ({
    value: f[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k, e.target.value as never),
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await fetch(policy ? `/api/policies/${policy.id}` : "/api/policies", {
      method: policy ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fromForm(f)),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(errorText(body, "Couldn't save the policy."));
    onSaved(body, !policy);
  }

  async function remove() {
    if (!policy) return;
    if (!confirm("Delete this policy and its documents? Premiums already paid stay in Transactions.")) return;
    const res = await fetch(`/api/policies/${policy.id}`, { method: "DELETE" });
    if (res.ok) onDeleted(policy.id);
    else setError("Couldn't delete the policy.");
  }

  return (
    <Modal title={policy ? "Edit policy" : "Add a policy"} onClose={onClose}>
      <form onSubmit={save} className="space-y-5 px-5 py-4">
        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Policy</legend>
          <L label="Type">
            <select {...bind("kind")} className={input}>
              {POLICY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {POLICY_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </L>
          <L label="Status">
            <select {...bind("status")} className={input}>
              {POLICY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {POLICY_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </L>
          <L label="Insurer *">
            <input required {...bind("insurer")} className={input} placeholder="LIC of India, HDFC Life..." />
          </L>
          <L label="Plan name / number">
            <input {...bind("planName")} className={input} placeholder="Jeevan Anand (915)" />
          </L>
          <L label="Policy number">
            <input {...bind("policyNumber")} className={input} />
          </L>
          <L label="Currency">
            <select {...bind("currency")} className={input}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </L>
          <L label="Sum assured">
            <input type="number" step="0.01" min="0" {...bind("sumAssured")} className={input} />
          </L>
          <L label="Maturity amount (expected)">
            <input type="number" step="0.01" min="0" {...bind("maturityAmount")} className={input} placeholder="For LIC endowment" />
          </L>
          <L label="Start date">
            <input type="date" {...bind("startDate")} className={input} />
          </L>
          <L label={f.kind === "TERM" ? "Cover ends" : "Maturity date"}>
            <input type="date" {...bind("endDate")} className={input} />
          </L>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Premiums</legend>
          <L label="Premium amount">
            <input type="number" step="0.01" min="0" {...bind("premiumAmount")} className={input} />
          </L>
          <L label="How often">
            <select {...bind("premiumFrequency")} className={input}>
              <option value="">—</option>
              {PREMIUM_FREQUENCIES.map((x) => (
                <option key={x} value={x}>
                  {FREQUENCY_LABELS[x]}
                </option>
              ))}
            </select>
          </L>
          <L label="Next premium due">
            <input type="date" {...bind("nextDueDate")} className={input} />
          </L>
          <L label="Last premium date">
            <input type="date" {...bind("premiumEndDate")} className={input} />
          </L>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">People, contacts and login</legend>
          <L label="Person insured">
            <input {...bind("insuredPerson")} className={input} />
          </L>
          <L label="Nominee">
            <input {...bind("nominee")} className={input} />
          </L>
          <L label="Agent name">
            <input {...bind("agentName")} className={input} />
          </L>
          <L label="Agent phone">
            <input {...bind("agentPhone")} className={input} />
          </L>
          <L label="Insurer helpline">
            <input {...bind("helpline")} className={input} />
          </L>
          <L label="Website / portal">
            <input {...bind("website")} className={input} placeholder="licindia.in" />
          </L>
          <L label="Login (where it's kept, user ID — no password)" wide>
            <input {...bind("loginNote")} className={input} placeholder="Bitwarden → 'LIC portal', user ID rajesh123" />
          </L>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Other details</legend>
          {f.extraFields.map((x, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={x.label}
                onChange={(e) =>
                  set(
                    "extraFields",
                    f.extraFields.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)),
                  )
                }
                placeholder="Label (e.g. Rider)"
                className="w-2/5 rounded-md border px-3 py-2 text-sm"
              />
              <input
                value={x.value}
                onChange={(e) =>
                  set(
                    "extraFields",
                    f.extraFields.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)),
                  )
                }
                placeholder="Value"
                className="flex-1 rounded-md border px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() =>
                  set(
                    "extraFields",
                    f.extraFields.filter((_, j) => j !== i),
                  )
                }
                className="px-2 text-gray-400 hover:text-red-500"
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set("extraFields", [...f.extraFields, { label: "", value: "" }])}
            className="text-xs text-brand-600 hover:underline"
          >
            + Add a detail (rider, branch code, policy term...)
          </button>
          <textarea {...bind("notes")} rows={3} className={input} placeholder="Notes" />
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between border-t pt-4">
          {policy ? (
            <button type="button" onClick={remove} className="text-sm text-red-500 hover:underline">
              Delete policy
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// The category a premium is filed under: an existing insurance category,
// or a new one (life/endowment as savings, others as a bill).
function suggestedCategory(policy: Policy, categories: Category[]) {
  const life = policy.kind === "LIFE";
  const match =
    (life && categories.find((c) => /\blic\b|life insurance/i.test(c.name))) ||
    (policy.kind === "TERM" && categories.find((c) => /term/i.test(c.name) && /insur/i.test(c.name))) ||
    categories.find((c) => /insurance/i.test(c.name) && !/car|auto|vehicle|rental|health/i.test(c.name));
  if (match) return { id: match.id, create: null };
  return {
    id: "new",
    create: life
      ? {
          name: "Life Insurance (LIC)",
          direction: "EXPENSE",
          kind: "SAVINGS",
          group: "SAVINGS",
        }
      : {
          name: "Insurance Premiums",
          direction: "EXPENSE",
          kind: "BILL",
          group: "OBLIGATIONS",
        },
  };
}

function PayDialog({
  policy,
  instruments,
  categories,
  onClose,
  onPaid,
  onCategoryCreated,
}: {
  policy: Policy;
  instruments: Instrument[];
  categories: Category[];
  onClose: () => void;
  onPaid: (p: Policy) => void;
  onCategoryCreated: (c: Category) => void;
}) {
  const suggestion = suggestedCategory(policy, categories);
  const accounts = instruments.filter((i) => i.currency === policy.currency);
  const premium = policy.premiumAmount !== null ? String(policy.premiumAmount) : "";
  const firstId = accounts[0]?.id ?? instruments[0]?.id ?? "";
  const firstSame = instruments.find((i) => i.id === firstId)?.currency === policy.currency;
  // The premium is only pre-filled when the account is in the policy's
  // currency: paying an INR premium from a USD account is recorded as the
  // USD amount actually charged.
  const [amount, setAmount] = useState(firstSame ? premium : "");
  const [date, setDate] = useState(getTodayLocal());
  const [instrumentId, setInstrumentId] = useState(firstId);
  const [categoryId, setCategoryId] = useState(suggestion.id);
  const [advance, setAdvance] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = instruments.filter((i) => i.currency !== policy.currency);
  const accountCurrency = instruments.find((i) => i.id === instrumentId)?.currency ?? policy.currency;
  function chooseAccount(id: string) {
    const same = instruments.find((i) => i.id === id)?.currency === policy.currency;
    if (same && !amount) setAmount(premium);
    if (!same && amount === premium) setAmount("");
    setInstrumentId(id);
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    let catId = categoryId;
    if (catId === "new" && suggestion.create) {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suggestion.create),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaving(false);
        return setError(errorText(body, "Couldn't create the category."));
      }
      onCategoryCreated(body);
      catId = body.id;
    }
    const res = await fetch(`/api/policies/${policy.id}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(amount),
        date,
        instrumentId,
        categoryId: catId,
        advance,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(errorText(body, "Couldn't record the payment."));
    onPaid(body);
  }

  return (
    <Modal title={`Pay premium · ${policy.insurer}${policy.planName ? ` ${policy.planName}` : ""}`} onClose={onClose}>
      <form onSubmit={pay} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
        <L label={`Amount (${accountCurrency})`}>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={input}
          />
        </L>
        <L label="Paid on">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </L>
        <L label="Paid from">
          <select value={instrumentId} onChange={(e) => chooseAccount(e.target.value)} className={input}>
            {accounts.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
            {others.length > 0 && (
              <optgroup label="Other currencies">
                {others.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.currency})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </L>
        <L label="Category">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input}>
            {suggestion.create && <option value="new">+ New: {suggestion.create.name}</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </L>
        {accountCurrency !== policy.currency && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-2">
            This account is in {accountCurrency}. Enter the {accountCurrency} amount it was charged (the premium is{" "}
            {policy.premiumAmount !== null ? money(policy.currency, policy.premiumAmount) : `in ${policy.currency}`}).
          </p>
        )}
        {policy.nextDueDate && (
          <label className="flex items-center gap-2 text-sm text-gray-600 sm:col-span-2">
            <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
            This pays the premium due {formatDate(policy.nextDueDate)}: move the next due date on
          </label>
        )}
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !instrumentId}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Record payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
