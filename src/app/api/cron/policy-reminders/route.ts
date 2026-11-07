import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calendarDateInZone } from "@/lib/appTimezone";
import { REMINDER_DAYS, daysBetween, reminderText } from "@/lib/policies";
import { sendMessage, telegramConfigured } from "@/lib/telegram";

// Runs once a day (vercel.json). For every active policy whose premium is
// due in 15, 7 or 2 days or today, tells each household member: a
// notification in the app, and a Telegram message to anyone who linked the
// bot. Protected by CRON_SECRET like the other cron route.
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

  return NextResponse.json({ checked: due.length, reminders });
}
