// Insurance policies (LIC, term, health...): their kinds and premium
// schedule. Pure -- no Prisma, no React -- so it can be tested alone and
// used by both the API and the Policies page.

import { z } from "zod";
import { xirr } from "./xirr";

export { xirr };

export const POLICY_KINDS = ["LIFE", "TERM", "HEALTH", "VEHICLE", "OTHER"] as const;
export const PolicyKind = z.enum(POLICY_KINDS);
export type PolicyKind = z.infer<typeof PolicyKind>;

export const POLICY_KIND_LABELS: Record<PolicyKind, string> = {
  LIFE: "Life (LIC endowment / money-back)",
  TERM: "Term life",
  HEALTH: "Health",
  VEHICLE: "Vehicle",
  OTHER: "Other",
};

export const POLICY_STATUSES = ["ACTIVE", "PAID_UP", "MATURED", "LAPSED", "SURRENDERED"] as const;
export const PolicyStatus = z.enum(POLICY_STATUSES);
export type PolicyStatus = z.infer<typeof PolicyStatus>;

export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  ACTIVE: "Active",
  PAID_UP: "Premiums done",
  MATURED: "Matured",
  LAPSED: "Lapsed",
  SURRENDERED: "Surrendered",
};

export const PREMIUM_FREQUENCIES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "SINGLE"] as const;
export const PremiumFrequency = z.enum(PREMIUM_FREQUENCIES);
export type PremiumFrequency = z.infer<typeof PremiumFrequency>;

export const FREQUENCY_LABELS: Record<PremiumFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
  SINGLE: "Single premium",
};

const MONTHS: Record<PremiumFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
  SINGLE: 0,
};

// Premium per year, for totals. A single premium is paid once, so it adds
// nothing to the yearly cost.
export function annualPremium(amount: number, frequency: string | null): number {
  const m = MONTHS[frequency as PremiumFrequency];
  return m ? (amount * 12) / m : 0;
}

// YYYY-MM-DD plus whole months, keeping the day of month where it exists
// (Jan 31 + 1 month = Feb 28/29, as insurers do).
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

// The due date after this one, or null when no more premiums are due
// (a single premium, or past the last premium date).
export function nextDueAfter(due: string, frequency: string | null, premiumEndDate: string | null): string | null {
  const m = MONTHS[frequency as PremiumFrequency];
  if (!m) return null;
  const next = addMonths(due, m);
  if (premiumEndDate && next > premiumEndDate.slice(0, 10)) return null;
  return next;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

// Days before the due date when a reminder goes out (0 = on the day).
export const REMINDER_DAYS = [15, 7, 2, 0];

// LIC (and most Indian insurers) allow 30 days' grace after the due date
// (15 for monthly premiums) before a policy lapses.
export function graceDays(frequency: string | null): number {
  return frequency === "MONTHLY" ? 15 : 30;
}

export function reminderText(p: {
  insurer: string;
  planName: string | null;
  policyNumber: string | null;
  insuredPerson: string | null;
  currency: string;
  premiumAmount: number | null;
  daysLeft: number;
  due: string;
}): string {
  const name = [p.insurer, p.planName].filter(Boolean).join(" ");
  const who = p.insuredPerson ? ` for ${p.insuredPerson}` : "";
  const num = p.policyNumber ? ` (policy ${p.policyNumber})` : "";
  const amt =
    p.premiumAmount !== null
      ? `${p.currency} ${p.premiumAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "Premium";
  const when = p.daysLeft === 0 ? "is due today" : p.daysLeft === 1 ? "is due tomorrow" : `is due in ${p.daysLeft} days (${p.due})`;
  return `${amt} premium for ${name}${who}${num} ${when}.`;
}

export type PolicyForSummary = {
  kind: string;
  status: string;
  currency: string;
  sumAssured: number | null;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  nextDueDate: string | null;
};

// Life cover and yearly premiums per currency, over active policies.
export function summarize(policies: PolicyForSummary[]) {
  const cover: Record<string, number> = {};
  const yearly: Record<string, number> = {};
  for (const p of policies) {
    if (p.status !== "ACTIVE" && p.status !== "PAID_UP") continue;
    if ((p.kind === "LIFE" || p.kind === "TERM") && p.sumAssured) cover[p.currency] = (cover[p.currency] ?? 0) + p.sumAssured;
    if (p.status === "ACTIVE" && p.premiumAmount && p.nextDueDate) {
      yearly[p.currency] = (yearly[p.currency] ?? 0) + annualPremium(p.premiumAmount, p.premiumFrequency);
    }
  }
  return { cover, yearly };
}

// Account numbers are shown masked: ••••1234.
export function last4Of(accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, "");
  return digits.slice(-4);
}

// Largest file kept with a policy (Vercel caps a request body at 4.5 MB).
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

const ymdToMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

export type ScheduleInput = {
  status: string;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  startDate: string | null; // first premium is paid on the start date
  nextDueDate: string | null; // first premium not yet paid
  premiumEndDate: string | null; // last premium (inclusive)
  endDate: string | null; // maturity / cover end
};

export type Schedule = {
  total: number | null; // null: open-ended (no last premium or end date)
  paid: number;
  left: number | null;
  paidAmount: number;
  leftAmount: number | null;
  lastDue: string | null;
  dueDates: string[]; // every premium date (empty when open-ended)
};

// How many premiums the policy takes in all, how many are paid and how many
// are left, from its start date, frequency and last premium date -- so
// premiums paid before the app was used count too. Premiums before the next
// due date are taken as paid (or every premium, once premiums are done).
// Null when there isn't enough to work it out (no start date or premium).
export function premiumSchedule(p: ScheduleInput, today: string): Schedule | null {
  if (!p.startDate || p.premiumAmount === null || !p.premiumFrequency) return null;
  const amount = p.premiumAmount;
  if (p.premiumFrequency === "SINGLE") {
    const paid = p.startDate <= today ? 1 : 0;
    return { total: 1, paid, left: 1 - paid, paidAmount: paid * amount, leftAmount: (1 - paid) * amount, lastDue: p.startDate, dueDates: [p.startDate] };
  }
  const step = MONTHS[p.premiumFrequency as PremiumFrequency];
  if (!step) return null;

  const last = p.premiumEndDate?.slice(0, 10) ?? null;
  const end = p.endDate?.slice(0, 10) ?? null;
  const within = (d: string) => (last ? d <= last : end ? d < end : true);
  const paidBefore = p.status === "ACTIVE" ? (p.nextDueDate?.slice(0, 10) ?? null) : null;
  const done = p.status !== "ACTIVE" && p.status !== "LAPSED";

  const dates: string[] = [];
  let paid = 0;
  const open = !last && !end;
  for (let k = 0; k < 1200; k++) {
    const d = addMonths(p.startDate, k * step);
    if (!within(d)) break;
    const isPaid = done ? d <= today : paidBefore ? d < paidBefore : d <= today;
    if (isPaid) paid++;
    // Open-ended: stop listing once past today and unpaid.
    if (open && !isPaid) break;
    dates.push(d);
  }
  const total = open ? null : dates.length;
  const left = total === null ? null : Math.max(0, total - paid);
  return {
    total,
    paid,
    left,
    paidAmount: paid * amount,
    leftAmount: left === null ? null : left * amount,
    lastDue: open ? null : (dates[dates.length - 1] ?? null),
    dueDates: open ? [] : dates,
  };
}

// For a savings policy (LIC endowment): every premium against the maturity
// payout. The yearly return is what the policy earns, comparable to an FD
// or PPF rate. Money-back instalments paid in between aren't known here, so
// for a money-back plan the real return is higher than shown.
export function maturityReturn(schedule: Schedule, maturityAmount: number | null, endDate: string | null, premium: number) {
  if (!maturityAmount || !endDate || schedule.total === null || !schedule.dueDates.length) return null;
  const totalPremiums = schedule.total * premium;
  const rate = xirr([...schedule.dueDates.map((d) => ({ date: d, amount: -premium })), { date: endDate.slice(0, 10), amount: maturityAmount }]);
  return { totalPremiums, gain: maturityAmount - totalPremiums, rate };
}
