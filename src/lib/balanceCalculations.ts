import { prisma } from "@/lib/prisma";

// Current balance is deliberately never stored on the PaymentInstrument row
// itself -- it's always derived from openingBalance plus every income/expense
// transaction logged against that instrument since openingBalanceDate, so it
// can never drift if a transaction is later edited or deleted. Same pattern
// used for Debt balances elsewhere in the app.
//
// Only transactions in the instrument's own currency count toward its
// balance -- mixing currencies into one running total would be meaningless
// (a $500 balance doesn't become 500 after a ₹500 transaction). A
// multi-currency account isn't modeled here; use separate instruments per
// currency if needed.
export async function computeInstrumentBalance(
  instrumentId: string,
  openingBalance: number,
  openingBalanceDate: Date
): Promise<number> {
  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument) return openingBalance;

  const transactions = await prisma.transaction.findMany({
    where: { instrumentId, date: { gte: openingBalanceDate }, currency: instrument.currency },
    include: { category: true },
  });

  let balance = openingBalance;
  for (const t of transactions) {
    balance += t.category.direction === "INCOME" ? Number(t.amount) : -Number(t.amount);
  }
  return Math.round(balance * 100) / 100;
}
