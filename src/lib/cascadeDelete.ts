import { prisma } from "@/lib/prisma";

// SQL Server refuses to create a schema with more than one ON DELETE CASCADE
// path to the same table (e.g. Household -> Transaction directly, AND
// Household -> PaymentInstrument -> Transaction, would both cascade into
// Transaction). Every relation in schema.prisma is deliberately NoAction,
// so deletes that should cascade have to be done explicitly, in the right
// child-first order, here.

export async function deleteHouseholdCascade(householdId: string) {
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { householdId } }),
    prisma.recurringTemplate.deleteMany({ where: { householdId } }),
    prisma.transactionCategory.deleteMany({ where: { householdId } }),
    prisma.paymentInstrument.deleteMany({ where: { householdId } }),
    prisma.user.deleteMany({ where: { householdId } }),
    prisma.household.delete({ where: { id: householdId } }),
  ]);
}

export async function deleteInstrumentCascade(instrumentId: string) {
  // Instruments are usually archived rather than deleted (see the
  // `archived` flag) once they have transaction history, since deleting
  // one out from under existing transactions would orphan them. This
  // helper is for the rare case of removing an instrument that was
  // created by mistake and has no transactions yet.
  const count = await prisma.transaction.count({ where: { instrumentId } });
  if (count > 0) {
    throw new Error(
      "This instrument has existing transactions — archive it instead of deleting, " +
        "or reassign its transactions to another instrument first."
    );
  }
  await prisma.$transaction([
    prisma.recurringTemplate.deleteMany({ where: { instrumentId } }),
    prisma.paymentInstrument.delete({ where: { id: instrumentId } }),
  ]);
}

export async function deleteCategoryCascade(categoryId: string, reassignToCategoryId?: string) {
  if (reassignToCategoryId) {
    await prisma.$transaction([
      prisma.transaction.updateMany({ where: { categoryId }, data: { categoryId: reassignToCategoryId } }),
      prisma.recurringTemplate.updateMany({ where: { categoryId }, data: { categoryId: reassignToCategoryId } }),
      prisma.transactionCategory.delete({ where: { id: categoryId } }),
    ]);
    return;
  }
  const count = await prisma.transaction.count({ where: { categoryId } });
  if (count > 0) {
    throw new Error("This category has existing transactions — pass reassignToCategoryId or reassign them first.");
  }
  await prisma.$transaction([
    prisma.recurringTemplate.deleteMany({ where: { categoryId } }),
    prisma.transactionCategory.delete({ where: { id: categoryId } }),
  ]);
}
