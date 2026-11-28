import { z } from "zod";

// Medicines at home: what's left, what has expired or soon will, how long
// it lasts at the usual dose. Pure -- src/lib/medicineData.ts loads the rows.
//
// Dates are calendar dates "YYYY-MM-DD". A pack counts as usable up to and
// including its expiry date; from the day after, it's expired.

export const EXPIRING_SOON_DAYS = 30;
// With a daily dose and no low-stock mark, this many days left is "running low".
export const LOW_DAYS = 7;
const DAY = 86_400_000;

export type Pack = {
  id: string;
  quantity: number;
  remaining: number;
  expiresOn: string | null;
  addedOn: string;
  discardedOn: string | null;
  note: string | null;
};

export type Draw = { stockId: string; quantity: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const isExpired = (p: Pick<Pack, "expiresOn">, today: string) => p.expiresOn != null && p.expiresOn < today;
const isUsable = (p: Pack, today: string) => !p.discardedOn && p.remaining > 0 && !isExpired(p, today);

// The order doses come out of packs: the one expiring first, packs with no
// date last, then the oldest bought.
export function usableInOrder(packs: Pack[], today: string): Pack[] {
  return packs
    .filter((p) => isUsable(p, today))
    .sort((a, b) => (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999") || a.addedOn.localeCompare(b.addedOn));
}

// Which packs a dose of `quantity` comes out of. `short` is what wasn't in
// stock (the dose is still recorded: the stock records may be behind).
export function drawDose(packs: Pack[], quantity: number, today: string): { draws: Draw[]; short: number } {
  let left = quantity;
  const draws: Draw[] = [];
  for (const p of usableInOrder(packs, today)) {
    if (left <= 0) break;
    const take = r2(Math.min(p.remaining, left));
    if (take <= 0) continue;
    draws.push({ stockId: p.id, quantity: take });
    left = r2(left - take);
  }
  return { draws, short: Math.max(0, left) };
}

export function parseDraws(json: string | null): Draw[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((d) => typeof d?.stockId === "string" && typeof d?.quantity === "number") : [];
  } catch {
    return [];
  }
}

export type MedicineStatus = {
  inStock: number; // usable: not expired, not thrown away
  expiredLeft: number; // still in the cupboard but past its date
  nextExpiry: string | null; // the soonest expiry among usable packs
  daysToExpiry: number | null;
  daysLeft: number | null; // at the daily dose
  runsOutOn: string | null;
  // At the daily dose, packs that will pass their date before they're reached.
  willExpireUnused: number;
  low: boolean;
  usedLast30: number;
  flags: ("EXPIRED" | "EXPIRING" | "LOW" | "OUT" | "WASTE")[];
};

export function medicineStatus(
  m: { dailyDose: number | null; lowStockAt: number | null },
  packs: Pack[],
  doses: { takenOn: string; quantity: number }[],
  today: string
): MedicineStatus {
  const usable = usableInOrder(packs, today);
  const inStock = r2(usable.reduce((s, p) => s + p.remaining, 0));
  const expiredLeft = r2(packs.filter((p) => !p.discardedOn && p.remaining > 0 && isExpired(p, today)).reduce((s, p) => s + p.remaining, 0));
  const nextExpiry = usable.find((p) => p.expiresOn)?.expiresOn ?? null;
  const daysToExpiry = nextExpiry ? daysBetween(today, nextExpiry) : null;

  // Walk the packs at the daily dose: each is reached once the ones before
  // it are used up; whatever is left when it passes its date goes to waste.
  let daysLeft: number | null = null;
  let willExpireUnused = 0;
  const dose = m.dailyDose && m.dailyDose > 0 ? m.dailyDose : null;
  if (dose) {
    let day = 0; // days of supply used before this pack
    for (const p of usable) {
      const lastDay = p.expiresOn ? daysBetween(today, p.expiresOn) : Infinity; // still usable on this day
      const daysOfPack = p.remaining / dose;
      const usableDays = Math.max(0, Math.min(daysOfPack, lastDay + 1 - day));
      if (usableDays < daysOfPack) willExpireUnused += (daysOfPack - usableDays) * dose;
      day += usableDays;
    }
    daysLeft = Math.floor(day);
    willExpireUnused = r2(willExpireUnused);
  }
  const runsOutOn = daysLeft != null ? addDays(today, daysLeft) : null;

  const low = m.lowStockAt != null ? inStock <= m.lowStockAt : daysLeft != null && daysLeft <= LOW_DAYS;
  const since = addDays(today, -29);
  const usedLast30 = r2(doses.filter((d) => d.takenOn >= since && d.takenOn <= today).reduce((s, d) => s + d.quantity, 0));

  const flags: MedicineStatus["flags"] = [];
  if (expiredLeft > 0) flags.push("EXPIRED");
  if (inStock <= 0 && packs.length > 0) flags.push("OUT");
  else if (low) flags.push("LOW");
  if (daysToExpiry != null && daysToExpiry <= EXPIRING_SOON_DAYS) flags.push("EXPIRING");
  if (willExpireUnused >= 1) flags.push("WASTE");

  return { inStock, expiredLeft, nextExpiry, daysToExpiry, daysLeft, runsOutOn, willExpireUnused, low, usedLast30, flags };
}

// "2 tablets", "1 tablet", "7.5 ml".
export function qty(n: number, unit: string): string {
  const v = Number.isInteger(n) ? String(n) : String(r2(n));
  const singular = n === 1 && /s$/.test(unit) && !/ss$/.test(unit) ? unit.slice(0, -1) : unit;
  return `${v} ${singular}`;
}

const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// One line for "Needs attention", or null when there's nothing to act on.
export function alertText(name: string, unit: string, s: MedicineStatus): { text: string; urgent: boolean } | null {
  if (s.flags.includes("EXPIRED")) return { text: `${name}: ${qty(s.expiredLeft, unit)} past the expiry date — throw away`, urgent: false };
  if (s.flags.includes("OUT")) return { text: `${name} has run out`, urgent: true };
  if (s.flags.includes("LOW")) {
    const when = s.daysLeft != null ? (s.daysLeft <= 0 ? " — lasts less than a day" : ` — lasts ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}`) : "";
    return { text: `${name} is running low: ${qty(s.inStock, unit)} left${when}`, urgent: s.daysLeft != null && s.daysLeft <= 2 };
  }
  if (s.flags.includes("EXPIRING") && s.nextExpiry) return { text: `${name} expires ${s.daysToExpiry === 0 ? "today" : `on ${shortDay(s.nextExpiry)}`}`, urgent: false };
  return null;
}

// Request bodies.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positive = z.coerce.number().positive().max(99_999);
const optionalPositive = z.union([z.literal(""), z.null(), positive]).optional().transform((v) => (v === "" || v == null ? null : v));
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

export const medicineFields = z.object({
  name: z.string().trim().min(1).max(200),
  strength: optionalText(50),
  unit: z.string().trim().min(1).max(30).default("tablets"),
  forWhom: optionalText(100),
  dailyDose: optionalPositive,
  lowStockAt: z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(99_999)]).optional().transform((v) => (v === "" || v == null ? null : v)),
  notes: optionalText(1000),
  archived: z.boolean().optional(),
});

export const stockFields = z.object({
  quantity: positive,
  remaining: z.coerce.number().min(0).max(99_999).optional(),
  expiresOn: z.union([z.literal(""), z.null(), date]).optional().transform((v) => v || null),
  addedOn: date.optional(),
  note: optionalText(200),
});

export const doseFields = z.object({
  quantity: positive,
  takenOn: date.optional(),
  note: optionalText(200),
});
