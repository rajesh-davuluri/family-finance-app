// Groups that categories roll up into, so reports can say "Food & Dining
// $X" and then break it down into Groceries and Dining Out. A category's
// group is stored on it (TransactionCategory.group); categories without one
// get a guess from their type and name (inferGroup), shown as such on the
// Categories page.

import { z } from "zod";
import { CategoryKind, kindOf } from "@/lib/categoryKind";

export const CATEGORY_GROUPS = [
  "INCOME",
  "HOUSING",
  "UTILITIES",
  "TRANSPORTATION",
  "FOOD",
  "FAMILY",
  "OBLIGATIONS",
  "LIFESTYLE",
  "SAVINGS",
  "TRANSFERS",
  "OTHER",
] as const;
export const CategoryGroup = z.enum(CATEGORY_GROUPS);
export type CategoryGroup = z.infer<typeof CategoryGroup>;

export const GROUP_LABELS: Record<CategoryGroup, string> = {
  INCOME: "Income",
  HOUSING: "Housing",
  UTILITIES: "Utilities & Communications",
  TRANSPORTATION: "Transportation",
  FOOD: "Food & Dining",
  FAMILY: "Family & Personal",
  OBLIGATIONS: "Loans, Fees & Taxes",
  LIFESTYLE: "Entertainment & Lifestyle",
  SAVINGS: "Savings & Investments",
  TRANSFERS: "Transfers & Card Payments",
  OTHER: "Other",
};

// A best guess from the category's type and name, for categories without a
// stored group.
export function inferGroup(name: string, kind: CategoryKind): CategoryGroup {
  if (kind === "INCOME" || kind === "REFUND") return "INCOME";
  if (kind === "SAVINGS") return "SAVINGS";
  if (kind === "TRANSFER" || kind === "LOAN") return "TRANSFERS";
  if (kind === "DEBT_PAYMENT") return "OBLIGATIONS";
  const n = name.toLowerCase();
  if (/rent|mortgage|\bhome\b|household|furniture|maintenance/.test(n)) return "HOUSING";
  if (/utilit|phone|mobile|internet|electric|water|power/.test(n)) return "UTILITIES";
  if (/\bcar\b|\bgas\b|fuel|transport|parking|toll|metro|commute|vehicle/.test(n)) return "TRANSPORTATION";
  if (/food|grocer|dining|restaurant|takeout|coffee/.test(n)) return "FOOD";
  if (/personal|medical|health|doctor|pharma|education|school|tuition|kid|child|cloth|shopping|gift/.test(n)) return "FAMILY";
  if (/fee|tax|insurance|bank|interest|government/.test(n)) return "OBLIGATIONS";
  if (/entertain|subscription|travel|vacation|movie|recreation|sport|membership|hobby/.test(n)) return "LIFESTYLE";
  return "OTHER";
}

type CategoryLike = { name: string; direction: string; kind?: string | null; group?: string | null };

export function groupOf(c: CategoryLike): CategoryGroup {
  const stored = CategoryGroup.safeParse(c.group);
  return stored.success ? stored.data : inferGroup(c.name, kindOf(c));
}
