import { z } from "zod";

// A paycheck's hours and pay period (Paychecks page). Each is optional; the
// pay period needs both ends, in order, at most two months long.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const paycheckDetailSchema = z
  .object({
    hoursPaid: z.number().positive().max(400).nullable().optional(),
    periodStart: date.nullable().optional(),
    periodEnd: date.nullable().optional(),
  })
  .refine((d) => !d.periodStart === !d.periodEnd, { message: "Enter both days of the pay period." })
  .refine((d) => !d.periodStart || !d.periodEnd || d.periodStart <= d.periodEnd, { message: "The pay period ends before it starts." })
  .refine(
    (d) => !d.periodStart || !d.periodEnd || Date.parse(`${d.periodEnd}T00:00:00Z`) - Date.parse(`${d.periodStart}T00:00:00Z`) <= 62 * 86_400_000,
    { message: "A pay period can't be longer than two months." }
  );

export type PaycheckDetailInput = z.infer<typeof paycheckDetailSchema>;

// Row values for prisma (dates as UTC midnight, like other date-only columns).
export function detailData(d: PaycheckDetailInput) {
  return {
    hoursPaid: d.hoursPaid ?? null,
    periodStart: d.periodStart ? new Date(`${d.periodStart}T00:00:00Z`) : null,
    periodEnd: d.periodEnd ? new Date(`${d.periodEnd}T00:00:00Z`) : null,
  };
}

export const hasDetail = (d: PaycheckDetailInput) => d.hoursPaid != null || !!d.periodStart;

export type PaycheckDetailView = { hoursPaid: number | null; periodStart: string | null; periodEnd: string | null };
