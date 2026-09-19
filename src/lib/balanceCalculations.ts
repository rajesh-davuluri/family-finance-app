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
export async function computeInstrumentBalance(
  instrumentId: string,
  openingBalance: number,
  openingBalanceDate: Date
): Promise<number> {
  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument) return openingBalance;

  const [transactions, transfersOut, transfersIn] = await Promise.all([
    prisma.transaction.findMany({
      where: { instrumentId, date: { gte: openingBalanceDate }, currency: instrument.currency },
      include: { category: true },
    }),
    prisma.transfer.findMany({
      where: { fromInstrumentId: instrumentId, date: { gte: openingBalanceDate }, currency: instrument.currency },
    }),
    prisma.transfer.findMany({
      where: { toInstrumentId: instrumentId, date: { gte: openingBalanceDate }, currency: instrument.currency },
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
