import { prisma } from "@/lib/prisma";
import { calendarDateInZone } from "@/lib/appTimezone";
import { REMINDER_DAYS, daysBetween, reminderText } from "@/lib/policies";
import { sendMessage, telegramConfigured } from "@/lib/telegram";
import { loadCards } from "@/lib/cardData";
import { cardReminder } from "@/lib/cards";
import { budgetAlert } from "@/lib/budgets";
import { toApproxUsd } from "@/lib/fx";
import { kindOf } from "@/lib/categoryKind";
import { summariesDue, summaryText } from "@/lib/moneySummary";
import { LATE_DAYS, md } from "@/lib/returns";

// The daily jobs. vercel.json runs them all in one call (/api/cron/daily) so
// the serverless database wakes once a day, not once per job: each wake keeps
// it running, and billed, until it auto-pauses again.

function advance(date: Date, frequency: string): Date {
  const next = new Date(date);
  if (frequency === "WEEKLY") next.setDate(next.getDate() + 7);
  else if (frequency === "MONTHLY") next.setMonth(next.getMonth() + 1);
  else if (frequency === "YEARLY") next.setFullYear(next.getFullYear() + 1);
  return next;
}

// Turns due RecurringTemplate rows into Transaction rows and advances
// nextRunAt.
export async function generateRecurring() {
  const now = new Date();
  const due = await prisma.recurringTemplate.findMany({
    // A template on an archived (closed) card or account doesn't run: the
    // account isn't used any more. It stays, paused in effect, until it's
    // moved to another account or the account is unarchived.
    where: { active: true, nextRunAt: { lte: now }, instrument: { archived: false } },
  });

  let generated = 0;
  for (const template of due) {
    const householdAdmin = await prisma.user.findFirst({ where: { householdId: template.householdId } });
    if (!householdAdmin) continue; // orphaned template — nothing to attribute the transaction to

    // A household could miss several cycles if the cron didn't run for a
    // while — catch up by generating one transaction per elapsed period,
    // capped at 24 to avoid runaway loops from a very stale template.
    let runAt = template.nextRunAt;
    let iterations = 0;
    while (runAt <= now && iterations < 24) {
      await prisma.transaction.create({
        data: {
          amount: template.amount,
          currency: template.currency,
          date: runAt,
          notes: template.notes ? `${template.notes} (recurring)` : "Recurring transaction",
          categoryId: template.categoryId,
          instrumentId: template.instrumentId,
          householdId: template.householdId,
          createdById: householdAdmin.id,
          recurringTemplateId: template.id,
          source: "RECURRING",
        },
      });
      generated++;
      runAt = advance(runAt, template.frequency);
      iterations++;
    }
    await prisma.recurringTemplate.update({ where: { id: template.id }, data: { nextRunAt: runAt } });
  }

  return { processedTemplates: due.length, transactionsGenerated: generated };
}

// Premium reminders (15, 7, 2 days before and on the day), card bill
// reminders and budget alerts, to each household member in the app and on
// Telegram.
export async function sendReminders() {
  const today = calendarDateInZone();
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + Math.max(...REMINDER_DAYS));

  const due = await prisma.insurancePolicy.findMany({
    where: {
      status: "ACTIVE",
      nextDueDate: { gte: new Date(`${today}T00:00:00Z`), lte: horizon },
    },
  });

  let reminders = 0;
  for (const p of due) {
    const dueDay = p.nextDueDate!.toISOString().slice(0, 10);
    const daysLeft = daysBetween(today, dueDay);
    if (!REMINDER_DAYS.includes(daysLeft)) continue;

    const message = reminderText({
      insurer: p.insurer,
      planName: p.planName,
      policyNumber: p.policyNumber,
      insuredPerson: p.insuredPerson,
      currency: p.currency,
      premiumAmount: p.premiumAmount === null ? null : Number(p.premiumAmount),
      daysLeft,
      due: dueDay,
    });

    const members = await prisma.user.findMany({
      where: { householdId: p.householdId },
      select: { id: true },
    });
    await prisma.notification.createMany({
      data: members.map((m) => ({
        householdId: p.householdId,
        userId: m.id,
        message,
      })),
    });
    if (telegramConfigured()) {
      const chats = await prisma.telegramLink.findMany({
        where: { householdId: p.householdId },
        select: { chatId: true },
      });
      for (const c of chats) await sendMessage(c.chatId, `🔔 ${message}`);
    }
    reminders++;
  }

  const cardReminders = await remindCards(today);
  const budgetAlerts = await remindBudgets(today);
  const returnReminders = await remindReturns(today);
  return { checked: due.length, reminders, cardReminders, budgetAlerts, returnReminders };
}

// Returns: 3 days and 1 day before a return window closes, and once when a
// refund is LATE_DAYS overdue. Exact days, so each is sent once.
async function remindReturns(today: string) {
  const at = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000);
  const name = (t: { notes: string | null; category: { name: string } }) => t.notes?.trim() || t.category.name;
  const closing = await prisma.transaction.findMany({
    where: { returnState: null, returnBy: { in: [at(3), at(1)] } },
    select: { householdId: true, notes: true, returnBy: true, category: { select: { name: true } } },
  });
  for (const t of closing) {
    const left = Math.round((t.returnBy!.getTime() - at(0).getTime()) / 86_400_000);
    await tell(t.householdId, `Last chance to return ${name(t)}: ${left === 1 ? "tomorrow is the last day" : `by ${md(t.returnBy!.toISOString().slice(0, 10))} (${left} days)`}.`, "↩️");
  }
  const late = await prisma.transaction.findMany({
    where: { returnState: "RETURNING", refundTxnId: null, returnSentOn: at(-LATE_DAYS) },
    select: { householdId: true, notes: true, currency: true, amount: true, returnExpected: true, category: { select: { name: true } } },
  });
  for (const t of late) {
    const expected = Number(t.returnExpected ?? t.amount);
    await tell(t.householdId, `${name(t)}: the ${t.currency === "USD" ? "$" : `${t.currency} `}${expected.toFixed(2)} refund hasn't arrived, ${LATE_DAYS} days after sending it back. Worth chasing the store.`, "↩️");
  }
  return closing.length + late.length;
}

async function tell(householdId: string, message: string, icon: string) {
  const members = await prisma.user.findMany({ where: { householdId }, select: { id: true } });
  await prisma.notification.createMany({ data: members.map((m) => ({ householdId, userId: m.id, message })) });
  if (telegramConfigured()) {
    const chats = await prisma.telegramLink.findMany({ where: { householdId }, select: { chatId: true } });
    for (const c of chats) await sendMessage(c.chatId, `${icon} ${message}`);
  }
}

// Credit card bills: from each card's statement snapshot (Credit cards page).
async function remindCards(today: string) {
  const households = await prisma.paymentInstrument.findMany({
    where: { type: "CREDIT_CARD", archived: false, statementDay: { not: null } },
    select: { householdId: true },
    distinct: ["householdId"],
  });
  let sent = 0;
  for (const { householdId } of households) {
    for (const card of await loadCards(householdId, today)) {
      const message = cardReminder(card, card.snapshot);
      if (!message) continue;
      await tell(householdId, message, "💳");
      sent++;
    }
  }
  return sent;
}

// Budgets: an alert at 80% of a monthly limit and another once it's over,
// each once a month. Spending is counted as on the Budgets page.
async function remindBudgets(today: string) {
  const month = today.slice(0, 7);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const daysLeft = new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(today.slice(8, 10));
  const monthStart = new Date(`${month}-01T00:00:00Z`);
  const budgets = await prisma.budget.findMany({ include: { category: { select: { name: true } } } });
  let sent = 0;
  for (const householdId of new Set(budgets.map((b) => b.householdId))) {
    const txns = await prisma.transaction.findMany({
      where: { householdId, date: { gte: monthStart }, category: { direction: "EXPENSE" } },
      select: { categoryId: true, amount: true, currency: true },
    });
    const spent = new Map<string, number>();
    for (const t of txns) spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + toApproxUsd(Number(t.amount), t.currency));
    for (const b of budgets.filter((x) => x.householdId === householdId)) {
      const alert = budgetAlert({
        name: b.category.name,
        limit: Number(b.monthlyLimit),
        spent: spent.get(b.categoryId) ?? 0,
        month,
        alertedNear: b.alertedNearMonth,
        alertedOver: b.alertedOverMonth,
        daysLeft,
      });
      if (!alert) continue;
      await tell(householdId, alert.text, alert.level === "over" ? "🚨" : "⚠️");
      await prisma.budget.update({
        where: { id: b.id },
        data: alert.level === "over" ? { alertedOverMonth: month } : { alertedNearMonth: month },
      });
      sent++;
    }
  }
  return sent;
}

// The money summary on Telegram: Sundays for the week before, the 1st for
// the month before, to every linked chat of each household that has it on.
// Runs inside the one daily call, so it never wakes the database on its own.
export async function sendSummaries(today = calendarDateInZone()) {
  const periods = summariesDue(today);
  if (!periods.length || !telegramConfigured()) return { sent: 0 };
  const households = await prisma.household.findMany({
    where: { moneySummary: true, telegramLinks: { some: {} } },
    select: { id: true, telegramLinks: { select: { chatId: true } } },
  });
  let sent = 0;
  for (const h of households) {
    for (const p of periods) {
      const rows = await prisma.transaction.findMany({
        where: { householdId: h.id, date: { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) } },
        select: { amount: true, currency: true, category: { select: { name: true, direction: true, kind: true } } },
      });
      const text = summaryText(
        p,
        rows.map((t) => ({ usd: toApproxUsd(Number(t.amount), t.currency), kind: kindOf(t.category), categoryName: t.category.name })),
      );
      if (!text) continue;
      for (const c of h.telegramLinks) await sendMessage(c.chatId, text);
      sent++;
    }
  }
  return { sent };
}
