import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Called on a schedule (see vercel.json) to turn due RecurringTemplate rows
// into actual Transaction rows, then advance nextRunAt. Protected by
// CRON_SECRET so it can't be triggered by anyone who finds the URL — Vercel
// Cron sends this automatically as a bearer token when CRON_SECRET is set
// as an environment variable on the project.
//
// There's also a manual "Generate now" button on the /recurring page for
// households that don't want to wait for the schedule, which hits this
// same route with the secret attached.
function advance(date: Date, frequency: string): Date {
  const next = new Date(date);
  if (frequency === "WEEKLY") next.setDate(next.getDate() + 7);
  else if (frequency === "MONTHLY") next.setMonth(next.getMonth() + 1);
  else if (frequency === "YEARLY") next.setFullYear(next.getFullYear() + 1);
  return next;
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const due = await prisma.recurringTemplate.findMany({
    where: { active: true, nextRunAt: { lte: now } },
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
        },
      });
      generated++;
      runAt = advance(runAt, template.frequency);
      iterations++;
    }
    await prisma.recurringTemplate.update({ where: { id: template.id }, data: { nextRunAt: runAt } });
  }

  return NextResponse.json({ processedTemplates: due.length, transactionsGenerated: generated });
}
