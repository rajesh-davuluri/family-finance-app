import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calendarDateInZone } from "@/lib/appTimezone";
import { REMINDER_DAYS, daysBetween, reminderText } from "@/lib/policies";
import { sendMessage, telegramConfigured } from "@/lib/telegram";
import { loadCards } from "@/lib/cardData";
import { cardReminder } from "@/lib/cards";
import { budgetAlert } from "@/lib/budgets";
import { toApproxUsd } from "@/lib/fx";

// Runs once a day (vercel.json). For every active policy whose premium is
// due in 15, 7 or 2 days or today, and every credit card statement still
// unpaid 5 days or 1 day before its due date, on it, or the day after, tells
// each household member: a notification in the app, and a Telegram message
// to anyone who linked the bot. Protected by CRON_SECRET like the other cron
// route.
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

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
  return NextResponse.json({ checked: due.length, reminders, cardReminders, budgetAlerts });
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
