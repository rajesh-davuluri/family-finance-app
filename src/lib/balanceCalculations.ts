import { prisma } from "@/lib/prisma";

// Current balance is deliberately never stored on the PaymentInstrument row
// itself -- it's always derived from openingBalance plus every income/expense
// transaction AND every transfer touching that instrument since
// openingBalanceDate, so it can never drift if one is later edited or
// deleted. Same pattern used for Debt balances elsewhere in the app.
//
// Only activity in the instrument's own currency counts toward its balance
// -- mixing currencies into one running total would be meaningless (a $500
// balance doesn't become 500 after a ₹500 transaction). A multi-currency
// account isn't modeled here; use separate instruments per currency if
// needed.
//
// asOfDate is optional and lets a caller ask "what was the balance as of
// this past date" (used for the Net Worth trend) rather than the current
// balance -- omit it for the normal, current-balance case.
export async function computeInstrumentBalance(
  instrumentId: string,
  openingBalance: number,
  openingBalanceDate: Date,
  asOfDate?: Date
): Promise<number> {
  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument) return openingBalance;

  // Asking for a point in time before the opening balance was even set --
  // there's nothing earlier to reconstruct, so treat it as the opening
  // balance itself rather than guessing.
  if (asOfDate && asOfDate < openingBalanceDate) return openingBalance;

  const dateFilter = { gte: openingBalanceDate, ...(asOfDate ? { lte: asOfDate } : {}) };

  const [transactions, transfersOut, transfersIn] = await Promise.all([
    prisma.transaction.findMany({
      where: { instrumentId, date: dateFilter, currency: instrument.currency },
      include: { category: true },
    }),
    prisma.transfer.findMany({
      where: { fromInstrumentId: instrumentId, date: dateFilter, currency: instrument.currency },
    }),
    prisma.transfer.findMany({
      where: { toInstrumentId: instrumentId, date: dateFilter, currency: instrument.currency },
    }),
  ]);

  let balance = openingBalance;
  for (const t of transactions) {
    balance += t.category.direction === "INCOME" ? Number(t.amount) : -Number(t.amount);
  }
  for (const t of transfersOut) balance -= Number(t.amount);
  for (const t of transfersIn) balance += Number(t.amount);

  return Math.round(balance * 100) / 100;
}
