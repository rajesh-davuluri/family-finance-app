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

// What a balance adds on top of the starting balance: every transaction and
// transfer on the account dated on or after `since`, in its own currency,
// signed (money in positive). Explains a balance that looks too high or low:
// activity on the starting date itself counts, and so does anything dated in
// the future.
export async function balanceItems(instrumentId: string, since: Date) {
  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument) return [];
  const where = { date: { gte: since }, currency: instrument.currency };
  const [transactions, transfersOut, transfersIn] = await Promise.all([
    prisma.transaction.findMany({ where: { instrumentId, ...where }, include: { category: { select: { name: true, direction: true } } } }),
    prisma.transfer.findMany({ where: { fromInstrumentId: instrumentId, ...where }, include: { toInstrument: { select: { name: true } } } }),
    prisma.transfer.findMany({ where: { toInstrumentId: instrumentId, ...where }, include: { fromInstrument: { select: { name: true } } } }),
  ]);
  const items = [
    ...transactions.map((t) => ({
      id: t.id,
      kind: "TRANSACTION" as const,
      date: t.date.toISOString().slice(0, 10),
      label: t.category.name,
      notes: t.notes,
      amount: t.category.direction === "INCOME" ? Number(t.amount) : -Number(t.amount),
    })),
    ...transfersOut.map((t) => ({ id: t.id, kind: "TRANSFER" as const, date: t.date.toISOString().slice(0, 10), label: `Transfer to ${t.toInstrument.name}`, notes: t.notes, amount: -Number(t.amount) })),
    ...transfersIn.map((t) => ({ id: t.id, kind: "TRANSFER" as const, date: t.date.toISOString().slice(0, 10), label: `Transfer from ${t.fromInstrument.name}`, notes: t.notes, amount: Number(t.amount) })),
  ];
  return items.sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.amount) - Math.abs(a.amount));
}
