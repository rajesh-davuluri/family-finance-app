// Turns a recognised bank-statement line (src/lib/bankRules.ts) into what the
// import should do with it, using the household's own accounts and
// categories: a transfer to the right card, or the right category. When the
// household has no suitable category yet, it proposes a new one (created
// only if the row is actually imported). Pure, so it can be tested alone.

import { BankRule } from "@/lib/bankRules";
import type { CategoryGroup } from "@/lib/categoryGroups";
import type { CategoryKind } from "@/lib/categoryKind";

export type RuleCategory = { id: string; name: string; direction: "INCOME" | "EXPENSE"; effectiveKind?: string };
export type RuleInstrument = { id: string; name: string; type: string; last4: string | null; archived: boolean };
export type NewCategory = { id: string; name: string; direction: "INCOME" | "EXPENSE"; kind: CategoryKind; group: CategoryGroup };
// transferToId: the other account of a transfer -- where the money goes for
// money out, where it came from for money in.
export type RuleTarget = { label: string; categoryId?: string; transferToId?: string; newCategory?: NewCategory };

export const NEW_CATEGORY_PREFIX = "new:";

function proposed(name: string, direction: "INCOME" | "EXPENSE", kind: CategoryKind, group: CategoryGroup): NewCategory {
  return { id: `${NEW_CATEGORY_PREFIX}${name}`, name, direction, kind, group };
}

export function targetForRule(
  rule: BankRule,
  moneyIn: boolean,
  ctx: { categories: RuleCategory[]; instruments: RuleInstrument[]; importInstrumentId: string }
): RuleTarget {
  const dir = moneyIn ? "INCOME" : "EXPENSE";
  const cats = ctx.categories.filter((c) => c.direction === dir);
  const byKind = (kind: string, name?: RegExp) =>
    cats.find((c) => c.effectiveKind === kind && (!name || name.test(c.name))) ?? (name ? cats.find((c) => c.effectiveKind === kind) : undefined);
  const byName = (name: RegExp) => cats.find((c) => name.test(c.name));
  const accounts = ctx.instruments.filter((i) => !i.archived && i.id !== ctx.importInstrumentId);
  const category = (c: RuleCategory | undefined, fallback: NewCategory): RuleTarget =>
    c ? { label: rule.label, categoryId: c.id } : { label: rule.label, categoryId: fallback.id, newCategory: fallback };

  switch (rule.kind) {
    case "CARD_PAYMENT": {
      if (moneyIn) break;
      const cards = accounts.filter((i) => i.type === "CREDIT_CARD");
      const card =
        (rule.card.last4 && cards.find((c) => c.last4 === rule.card.last4)) ||
        (rule.card.name && cards.find((c) => rule.card.name!.test(c.name)));
      if (card) return { label: rule.label, transferToId: card.id };
      return category(byKind("TRANSFER", /card/i), proposed("Credit Card Payment", "EXPENSE", "TRANSFER", "TRANSFERS"));
    }
    case "PAYPAL_TOPUP": {
      const paypal = accounts.find((i) => /paypal/i.test(i.name));
      // To PayPal, or (money in) from it.
      if (paypal) return { label: rule.label, transferToId: paypal.id };
      return category(byKind("TRANSFER"), proposed(moneyIn ? "Transfer In" : "Transfer Out", dir, "TRANSFER", "TRANSFERS"));
    }
    case "OWN_TRANSFER": {
      // The account the line names: a transfer with it, either way.
      const named = rule.account && accounts.find((i) => i.type !== "CREDIT_CARD" && i.name === rule.account);
      if (named) return { label: rule.label, transferToId: named.id };
      // Otherwise a transfer-type category named for transfers (not "Card Payment Received").
      return category(
        cats.find((c) => c.effectiveKind === "TRANSFER" && /transfer|own account/i.test(c.name)),
        proposed(moneyIn ? "Transfer In" : "Transfer Out", dir, "TRANSFER", "TRANSFERS")
      );
    }
    case "SALARY":
      if (!moneyIn) break;
      return category(byName(/salary|payroll|paycheck/i), proposed("Salary", "INCOME", "INCOME", "INCOME"));
    case "REMITTANCE":
      if (moneyIn) break;
      // A transfer-type category: the money is still yours, in India.
      return category(
        cats.find((c) => c.effectiveKind === "TRANSFER" && /india|abroad|remit|international|overseas/i.test(c.name)),
        proposed("Transfer to India", "EXPENSE", "TRANSFER", "TRANSFERS")
      );
    case "INVESTMENT":
      if (moneyIn) break;
      return category(byKind("SAVINGS", /invest/i), proposed("Investment", "EXPENSE", "SAVINGS", "SAVINGS"));
    case "CASH_WITHDRAWAL": {
      if (moneyIn) break;
      const cash = accounts.find((i) => i.type === "CASH");
      if (cash) return { label: rule.label, transferToId: cash.id };
      return category(byName(/cash|atm/i), proposed("Cash Withdrawal", "EXPENSE", "SPENDING", "OTHER"));
    }
    case "UTILITY":
      if (moneyIn) break;
      return category(byName(/utilit/i) ?? byKind("BILL", /phone|internet|electric|water/i), proposed("Utilities", "EXPENSE", "BILL", "UTILITIES"));
    case "RENT":
      if (moneyIn) break;
      return category(byName(/rent|mortgage/i), proposed("Rent/Mortgage", "EXPENSE", "BILL", "HOUSING"));
  }
  return { label: rule.label };
}

// Rules for well-known billers only fill in a category when the household's
// own history didn't already suggest one; structural lines (card payments,
// paychecks, transfers, investing, cash) always win.
export function ruleOverridesHistory(rule: BankRule) {
  return rule.kind !== "UTILITY" && rule.kind !== "RENT";
}
