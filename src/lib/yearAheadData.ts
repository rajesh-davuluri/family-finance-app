import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toApproxUsd } from "@/lib/fx";
import { Currency } from "@/lib/enums";
import { countsAsSpending, kindOf } from "@/lib/categoryKind";
import { Payday, biweeklyPaydays, expectedPaydays, isSalary } from "@/lib/payCycles";
import { detectHouseholdRecurring } from "@/lib/recurringData";
import { addDays, daysBetween } from "@/lib/cashPlan";
import { HORIZON_DAYS, PlannedItem } from "@/lib/yearAhead";

// Gathers what the Year ahead page needs (src/lib/yearAhead.ts):
//   items        the household's planned expenses
//   paydays      every 14 days on from the last salary, for a year
//   suggestions  premiums, yearly recurring bills and quarterly-or-rarer
//                bills found in history that aren't on the list yet

const r2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

export const plannedFields = z.object({
  name: z.string().trim().min(1).max(200),
  amount: z.number().positive().max(100_000_000),
  currency: Currency,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  repeatMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]).nullable(),
  sourceKey: z.string().max(200).nullable().optional(),
});

type Row = { id: string; name: string; amount: unknown; currency: string; dueDate: Date; repeatMonths: number | null; sourceKey: string | null };
export function plannedItem(r: Row): PlannedItem {
  const amount = Number(r.amount);
  return { id: r.id, name: r.name, amount, currency: r.currency, usd: r2(toApproxUsd(amount, r.currency)), dueDate: ymd(r.dueDate), repeatMonths: r.repeatMonths, sourceKey: r.sourceKey };
}

export async function loadPlannedItems(householdId: string): Promise<PlannedItem[]> {
  const rows = await prisma.plannedExpense.findMany({ where: { householdId }, orderBy: { dueDate: "asc" } });
  return rows.map(plannedItem);
}

export type Suggestion = { key: string; name: string; amount: number; currency: string; usd: number; dueDate: string; repeatMonths: number | null; from: string };

const POLICY_REPEAT: Record<string, number | null> = { QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12, SINGLE: null };
const BILL_REPEAT: Record<string, number> = { QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };

export async function loadYearAhead(householdId: string, today: string) {
  const end = addDays(today, HORIZON_DAYS);
  const [household, items, incomeRows, policies, templates, recurring] = await Promise.all([
    prisma.household.findUnique({ where: { id: householdId }, select: { yearAheadSetAsideUsd: true, yearAheadPerPaydayUsd: true } }),
    loadPlannedItems(householdId),
    prisma.transaction.findMany({
      where: { householdId, category: { direction: "INCOME" } },
      select: { id: true, date: true, amount: true, currency: true, category: { select: { name: true, direction: true, kind: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.insurancePolicy.findMany({ where: { householdId, status: "ACTIVE", premiumAmount: { not: null }, nextDueDate: { not: null } } }),
    prisma.recurringTemplate.findMany({
      where: { householdId, active: true, frequency: "YEARLY", instrument: { archived: false } },
      include: { category: { select: { name: true, direction: true, kind: true } } },
    }),
    detectHouseholdRecurring(householdId, today),
  ]);

  // Paychecks: every 14 days on from the last one. With no salary recorded
  // yet, assume one every two weeks from a fortnight out.
  const salaries: Payday[] = incomeRows
    .filter((t) => isSalary(kindOf(t.category), t.category.name))
    .map((t) => ({ date: ymd(t.date), amount: Number(t.amount), currency: t.currency, usd: r2(toApproxUsd(Number(t.amount), t.currency)), transactionId: t.id }));
  let paydays: string[] = [];
  let paycheckUsd: number | null = null;
  if (salaries.length) {
    const run = biweeklyPaydays(salaries).paydays;
    const last = run[run.length - 1].date;
    paycheckUsd = r2(median(run.slice(-3).map((p) => p.usd)));
    const count = Math.min(400, Math.ceil(Math.max(0, daysBetween(last, end)) / 14));
    paydays = expectedPaydays(last, count).map((p) => p.likelyDate ?? p.date);
  } else {
    for (let d = addDays(today, 14); d <= end; d = addDays(d, 14)) paydays.push(d);
  }
  paydays = paydays.filter((d) => d > today && d <= end);

  // Things already known to the app that belong on the list.
  const taken = new Set(items.map((i) => i.sourceKey).filter(Boolean));
  const suggestions: Suggestion[] = [];
  const suggest = (s: Omit<Suggestion, "usd">) => {
    if (taken.has(s.key) || s.dueDate > end || s.amount <= 0) return;
    suggestions.push({ ...s, usd: r2(toApproxUsd(s.amount, s.currency)) });
  };
  for (const p of policies) {
    if (!p.premiumFrequency || !(p.premiumFrequency in POLICY_REPEAT)) continue; // monthly premiums are a regular bill
    suggest({
      key: `policy:${p.id}`,
      name: `${[p.insurer, p.planName].filter(Boolean).join(" ")} premium`,
      amount: Number(p.premiumAmount),
      currency: p.currency,
      dueDate: ymd(p.nextDueDate!),
      repeatMonths: POLICY_REPEAT[p.premiumFrequency],
      from: "Policy",
    });
  }
  const templateCategories = new Set<string>();
  for (const t of templates) {
    const kind = kindOf(t.category);
    if (!countsAsSpending(kind) || kind === "REFUND") continue;
    templateCategories.add(t.category.name);
    suggest({ key: `tpl:${t.id}`, name: t.notes || t.category.name, amount: Number(t.amount), currency: t.currency, dueDate: ymd(t.nextRunAt), repeatMonths: 12, from: "Recurring bill" });
  }
  for (const b of recurring.bills) {
    const repeat = BILL_REPEAT[b.frequency];
    if (!repeat || b.status === "STOPPED" || !countsAsSpending(b.kind) || b.kind === "REFUND" || templateCategories.has(b.categoryName)) continue;
    suggest({ key: `bill:${b.key}`, name: b.label, amount: b.amount, currency: b.currency, dueDate: b.nextDate, repeatMonths: repeat, from: "Found in your history" });
  }
  suggestions.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    today,
    items,
    paydays,
    paydaysAssumed: salaries.length === 0,
    paycheckUsd,
    setAsideUsd: household?.yearAheadSetAsideUsd != null ? Number(household.yearAheadSetAsideUsd) : 0,
    perPaydayUsd: household?.yearAheadPerPaydayUsd != null ? Number(household.yearAheadPerPaydayUsd) : null,
    suggestions,
  };
}
