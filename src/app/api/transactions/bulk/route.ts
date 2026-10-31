import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Currency } from "@/lib/enums";

const rowSchema = z.object({
  date: z.string(),
  amount: z.number().positive(),
  categoryId: z.string(),
  notes: z.string().optional(),
});

const bulkSchema = z.object({
  instrumentId: z.string(),
  currency: Currency,
  rows: z.array(rowSchema).min(1).max(1000),
  // Recorded in the import history, not used to create transactions.
  file: z
    .object({
      name: z.string().min(1).max(255),
      rowsInFile: z.number().int().nonnegative(),
      duplicateCount: z.number().int().nonnegative(),
      periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = bulkSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { instrumentId, currency, rows, file } = parsed.data;

  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument || instrument.householdId !== user.householdId) {
    return NextResponse.json({ error: "Invalid instrument." }, { status: 400 });
  }

  // Confirm every category referenced actually belongs to this household,
  // in one query rather than one per row.
  const categoryIds = Array.from(new Set(rows.map((r) => r.categoryId)));
  const validCategories = await prisma.transactionCategory.findMany({
    where: { id: { in: categoryIds }, householdId: user.householdId },
    select: { id: true },
  });
  if (validCategories.length !== categoryIds.length) {
    return NextResponse.json({ error: "One or more categories are invalid." }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        fileName: file?.name ?? "Unnamed file",
        currency,
        rowsInFile: file?.rowsInFile ?? rows.length,
        importedCount: rows.length,
        duplicateCount: file?.duplicateCount ?? 0,
        periodStart: file?.periodStart ? new Date(file.periodStart) : null,
        periodEnd: file?.periodEnd ? new Date(file.periodEnd) : null,
        householdId: user.householdId,
        instrumentId,
        createdById: user.id,
      },
    });
    return tx.transaction.createMany({
      data: rows.map((r) => ({
        amount: r.amount,
        currency,
        date: new Date(r.date),
        notes: r.notes,
        categoryId: r.categoryId,
        instrumentId,
        householdId: user.householdId,
        createdById: user.id,
        importBatchId: batch.id,
      })),
    });
  });

  return NextResponse.json({ imported: result.count }, { status: 201 });
}
