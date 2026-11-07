// Server-side helpers for insurance policies: the fields a policy form may
// send, turning them into Prisma data, and the shape the Policies page reads.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Currency } from "@/lib/enums";
import { PolicyKind, PolicyStatus, PremiumFrequency } from "@/lib/policies";

const text = (max = 200) => z.string().trim().max(max).nullable().optional();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();
const money = z.number().nonnegative().nullable().optional();

export const ExtraField = z.object({
  label: z.string().trim().min(1).max(100),
  value: z.string().trim().max(1000),
});

export const policyFields = z.object({
  kind: PolicyKind,
  status: PolicyStatus.optional(),
  insurer: z.string().trim().min(1).max(200),
  planName: text(),
  policyNumber: text(100),
  insuredPerson: text(),
  nominee: text(),
  currency: Currency,
  sumAssured: money,
  maturityAmount: money,
  premiumAmount: money,
  premiumFrequency: PremiumFrequency.nullable().optional(),
  nextDueDate: day,
  premiumEndDate: day,
  startDate: day,
  endDate: day,
  agentName: text(),
  agentPhone: text(50),
  helpline: text(100),
  website: text(500),
  loginNote: text(2000),
  notes: text(10000),
  extraFields: z.array(ExtraField).max(50).optional(),
});
export type PolicyFields = z.infer<typeof policyFields>;

const blankToNull = (v: string | null | undefined) => (v === undefined ? undefined : v && v.trim() ? v.trim() : null);
const asDate = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(`${v}T00:00:00Z`) : null);

export function policyData(f: Partial<PolicyFields>) {
  return {
    kind: f.kind,
    status: f.status,
    insurer: f.insurer,
    planName: blankToNull(f.planName),
    policyNumber: blankToNull(f.policyNumber),
    insuredPerson: blankToNull(f.insuredPerson),
    nominee: blankToNull(f.nominee),
    currency: f.currency,
    sumAssured: f.sumAssured,
    maturityAmount: f.maturityAmount,
    premiumAmount: f.premiumAmount,
    premiumFrequency: f.premiumFrequency,
    nextDueDate: asDate(f.nextDueDate),
    premiumEndDate: asDate(f.premiumEndDate),
    startDate: asDate(f.startDate),
    endDate: asDate(f.endDate),
    agentName: blankToNull(f.agentName),
    agentPhone: blankToNull(f.agentPhone),
    helpline: blankToNull(f.helpline),
    website: blankToNull(f.website),
    loginNote: blankToNull(f.loginNote),
    notes: blankToNull(f.notes),
    extraFields:
      f.extraFields === undefined
        ? undefined
        : f.extraFields.filter((x) => x.value).length
          ? JSON.stringify(f.extraFields.filter((x) => x.value))
          : null,
  };
}

export async function policyOf(id: string, householdId: string) {
  const p = await prisma.insurancePolicy.findUnique({ where: { id } });
  return p && p.householdId === householdId ? p : null;
}

// Everything the Policies page shows for a policy: its fields, the
// premiums paid on it and its documents (without their bytes).
export const policyInclude = {
  payments: {
    select: {
      id: true,
      amount: true,
      currency: true,
      date: true,
      notes: true,
      instrument: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  },
  documents: {
    select: {
      id: true,
      fileName: true,
      contentType: true,
      size: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.InsurancePolicyInclude;

type PolicyRow = Prisma.InsurancePolicyGetPayload<{
  include: typeof policyInclude;
}>;

export function policyJson(p: PolicyRow) {
  let extra: { label: string; value: string }[] = [];
  try {
    extra = p.extraFields ? z.array(ExtraField).parse(JSON.parse(p.extraFields)) : [];
  } catch {
    extra = [];
  }
  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
  return {
    ...p,
    sumAssured: num(p.sumAssured),
    maturityAmount: num(p.maturityAmount),
    premiumAmount: num(p.premiumAmount),
    nextDueDate: ymd(p.nextDueDate),
    premiumEndDate: ymd(p.premiumEndDate),
    startDate: ymd(p.startDate),
    endDate: ymd(p.endDate),
    extraFields: extra,
    payments: p.payments.map((t) => ({
      ...t,
      amount: Number(t.amount),
      date: ymd(t.date),
    })),
  };
}
