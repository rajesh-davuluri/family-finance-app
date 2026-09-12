import { z } from "zod";

// SQL Server doesn't support Prisma's native `enum` type, so every
// "enum-like" column in schema.prisma is a plain String. These zod enums
// are the single source of truth for valid values — use them wherever a
// value gets written to one of those columns.

export const UserRole = z.enum(["ADMIN", "MEMBER"]);
export type UserRole = z.infer<typeof UserRole>;

export const InstrumentType = z.enum(["BANK_ACCOUNT", "CREDIT_CARD", "CASH", "OTHER"]);
export type InstrumentType = z.infer<typeof InstrumentType>;

export const TransactionDirection = z.enum(["INCOME", "EXPENSE"]);
export type TransactionDirection = z.infer<typeof TransactionDirection>;

export const RecurrenceFrequency = z.enum(["WEEKLY", "MONTHLY", "YEARLY"]);
export type RecurrenceFrequency = z.infer<typeof RecurrenceFrequency>;

export const CURRENCIES = ["USD", "INR", "EUR", "GBP"] as const;
export const Currency = z.enum(CURRENCIES);
export type Currency = z.infer<typeof Currency>;
