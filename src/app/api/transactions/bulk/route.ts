import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { rememberNotDuplicates } from "@/lib/duplicateData";
import { Currency } from "@/lib/enums";

// A row is either a transaction in a category, or a transfer with another
// account of the household: money out (a card payment, a top-up, cash, a move
// to another bank) goes to that account, money in comes from it.
const rowSchema = z
  .object({
    date: z.string(),
    amount: z.number().positive(),
    categoryId: z.string().optional(),
    transferToInstrumentId: z.string().optional(),
    transferFromInstrumentId: z.string().optional(),
    notes: z.string().optional(),
    // Imported although it matched this transaction: not a duplicate of it.
    notDuplicateOf: z.string().max(64).optional(),
  })
  .refine((r) => [r.categoryId, r.transferToInstrumentId, r.transferFromInstrumentId].filter(Boolean).length === 1, {
    message: "Each row needs a category or a transfer account.",
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

  const txnRows = rows.filter((r) => r.categoryId);
  const transferRows = rows.filter((r) => r.transferToInstrumentId || r.transferFromInstrumentId);
  const otherAccount = (r: (typeof rows)[number]) => (r.transferToInstrumentId ?? r.transferFromInstrumentId)!;

  // Confirm every category and transfer account referenced belongs to this
  // household, in one query each rather than one per row.
  const categoryIds = Array.from(new Set(txnRows.map((r) => r.categoryId!)));
  const validCategories = await prisma.transactionCategory.findMany({
    where: { id: { in: categoryIds }, householdId: user.householdId },
    select: { id: true },
  });
  if (validCategories.length !== categoryIds.length) {
    return NextResponse.json({ error: "One or more categories are invalid." }, { status: 400 });
  }
  const targetIds = Array.from(new Set(transferRows.map(otherAccount)));
  const validTargets = await prisma.paymentInstrument.count({
    where: { id: { in: targetIds }, householdId: user.householdId, NOT: { id: instrumentId } },
  });
  if (validTargets !== targetIds.length) {
    return NextResponse.json({ error: "One or more transfer accounts are invalid." }, { status: 400 });
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
    // Rows kept despite matching an existing transaction are created one by
    // one, so the pair can be remembered as not a duplicate.
    const kept = txnRows.filter((r) => r.notDuplicateOf);
    const keptPairs: [string, string][] = [];
    for (const r of kept) {
      const t = await tx.transaction.create({
        data: {
          amount: r.amount,
          currency,
          date: new Date(r.date),
          notes: r.notes,
          categoryId: r.categoryId!,
          instrumentId,
          householdId: user.householdId,
          createdById: user.id,
          importBatchId: batch.id,
          source: "IMPORTED",
        },
        select: { id: true },
      });
      keptPairs.push([t.id, r.notDuplicateOf!]);
    }
    const created = await tx.transaction.createMany({
      data: txnRows.filter((r) => !r.notDuplicateOf).map((r) => ({
        amount: r.amount,
        currency,
        date: new Date(r.date),
        notes: r.notes,
        categoryId: r.categoryId!,
        instrumentId,
        householdId: user.householdId,
        createdById: user.id,
        importBatchId: batch.id,
        source: "IMPORTED",
      })),
    });
    const transfers = await tx.transfer.createMany({
      data: transferRows.map((r) => ({
        amount: r.amount,
        currency,
        date: new Date(r.date),
        notes: r.notes,
        fromInstrumentId: r.transferFromInstrumentId ?? instrumentId,
        toInstrumentId: r.transferToInstrumentId ?? instrumentId,
        householdId: user.householdId,
        createdById: user.id,
      })),
    });
    return { transactions: created.count + kept.length, transfers: transfers.count, keptPairs };
  });

  await rememberNotDuplicates(user.householdId, result.keptPairs);

  return NextResponse.json(
    { imported: result.transactions + result.transfers, transactions: result.transactions, transfers: result.transfers },
    { status: 201 }
  );
}
