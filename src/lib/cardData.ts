import { prisma } from "@/lib/prisma";
import { kindOf } from "@/lib/categoryKind";
import { addDays, cardSnapshot, classifyCardTransaction, type CardActivity } from "@/lib/cards";

// Every active credit card of a household with its statement snapshot (see
// src/lib/cards.ts): used by the Credit cards page, the dashboard tiles and
// the due-date reminders.

const day = (d: Date) => d.toISOString().slice(0, 10);

export type LoadedCard = Awaited<ReturnType<typeof loadCards>>[number];

export async function loadCards(householdId: string, today: string) {
  const cards = await prisma.paymentInstrument.findMany({
    where: { householdId, type: "CREDIT_CARD", archived: false },
    include: { cardStatements: { orderBy: { closingDate: "desc" } } },
    orderBy: { name: "asc" },
  });

  const out = await Promise.all(
    cards.map(async (card) => {
      // Enough history for six cycles, and back to the latest typed-in
      // statement so its balance can be rolled forward.
      const latest = card.cardStatements.find((s) => day(s.closingDate) <= today);
      let from = addDays(today, -230);
      if (latest && day(latest.closingDate) < from) from = day(latest.closingDate);
      const since = new Date(`${from}T00:00:00Z`);

      const [txns, transfersIn, transfersOut] = await Promise.all([
        prisma.transaction.findMany({
          where: { instrumentId: card.id, currency: card.currency, date: { gte: since } },
          include: { category: true },
        }),
        prisma.transfer.findMany({
          where: { toInstrumentId: card.id, currency: card.currency, date: { gte: since } },
          include: { fromInstrument: { select: { name: true } } },
        }),
        prisma.transfer.findMany({
          where: { fromInstrumentId: card.id, currency: card.currency, date: { gte: since } },
          include: { toInstrument: { select: { name: true } } },
        }),
      ]);

      const activity: CardActivity[] = [
        ...txns.map((t) => {
          const label = t.notes?.trim() || t.category.name;
          return {
            date: day(t.date),
            amount: Number(t.amount),
            kind: classifyCardTransaction(t.category.direction === "INCOME" ? "INCOME" : "EXPENSE", kindOf(t.category), `${t.category.name} ${t.notes ?? ""}`),
            source: "CARD" as const,
            label,
          };
        }),
        ...transfersIn.map((t) => ({
          date: day(t.date),
          amount: Number(t.amount),
          kind: "PAYMENT" as const,
          source: "TRANSFER" as const,
          label: `Payment from ${t.fromInstrument.name}`,
          transferId: t.id,
        })),
        ...transfersOut.map((t) => ({
          date: day(t.date),
          amount: Number(t.amount),
          kind: "CHARGE" as const,
          source: "CARD" as const,
          label: `Moved to ${t.toInstrument.name}`,
        })),
      ];

      const snapshot = cardSnapshot({
        statementDay: card.statementDay,
        dueDay: card.dueDay,
        creditLimit: card.creditLimit === null ? null : Number(card.creditLimit),
        today,
        statements: card.cardStatements.map((s) => ({
          id: s.id,
          closingDate: day(s.closingDate),
          balance: Number(s.balance),
          minimumDue: s.minimumDue === null ? null : Number(s.minimumDue),
          dueDate: s.dueDate ? day(s.dueDate) : null,
        })),
        activity,
      });

      return {
        id: card.id,
        name: card.name,
        last4: card.last4,
        currency: card.currency,
        statementDay: card.statementDay,
        dueDay: card.dueDay,
        creditLimit: card.creditLimit === null ? null : Number(card.creditLimit),
        statements: card.cardStatements.slice(0, 12).map((s) => ({
          id: s.id,
          closingDate: day(s.closingDate),
          balance: Number(s.balance),
          minimumDue: s.minimumDue === null ? null : Number(s.minimumDue),
          dueDate: s.dueDate ? day(s.dueDate) : null,
        })),
        snapshot: { ...snapshot, recent: snapshot.recent.slice(0, 40) },
      };
    })
  );

  return out;
}
