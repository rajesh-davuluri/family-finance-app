import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { householdForToken, webhookAuthorized } from "@/lib/inboundEmail";
import { htmlToText, parseBankAlert } from "@/lib/bankAlert";
import { suggestCategories } from "@/lib/categorize";
import { notifyWholeHousehold } from "@/lib/notify";

// Postmark inbound webhook: a household member's mailbox forwards bank
// card-alert emails to their household's private address, and each one
// becomes a transaction. Anything that can't be recorded safely (unreadable
// alert, refund, unknown card) becomes a notification instead of a guess.
//
// Always answers 200 once authorized -- a non-2xx makes Postmark retry the
// same email, which would only repeat the same outcome.

type PostmarkInbound = {
  MailboxHash?: string;
  OriginalRecipient?: string;
  To?: string;
  From?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Date?: string;
};

function tokenFrom(payload: PostmarkInbound): string {
  if (payload.MailboxHash) return payload.MailboxHash;
  const to = payload.OriginalRecipient ?? payload.To ?? "";
  return to.match(/\+([a-f0-9]+)@/i)?.[1] ?? "";
}

function money(currency: string, amount: number) {
  return `${currency} ${amount.toFixed(2)}`;
}

export async function POST(req: Request) {
  if (!webhookAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const payload: PostmarkInbound = await req.json();
  const householdId = await householdForToken(tokenFrom(payload));
  if (!householdId) return NextResponse.json({ status: "ignored", reason: "unknown address" });

  const subject = (payload.Subject ?? "").trim();
  const body = payload.TextBody?.trim() || htmlToText(payload.HtmlBody ?? "");

  // Gmail sends a confirmation to a new forwarding address before it will
  // forward anything -- pass its code/link on, since no one can read this
  // mailbox directly.
  if (/forwarding confirmation/i.test(subject)) {
    const code = body.match(/Confirmation code:\s*(\d+)/i)?.[1];
    const link = body.match(/https:\/\/mail[^\s"<>]*google\.com[^\s"<>]*/i)?.[0];
    await notifyWholeHousehold(
      householdId,
      `Email forwarding setup: ${subject}.${code ? ` Confirmation code: ${code}.` : ""}${link ? ` Or open: ${link}` : ""}`
    );
    return NextResponse.json({ status: "forwarding-confirmation" });
  }

  const alert = parseBankAlert(`${subject}. ${body}`);
  if (!alert) {
    await notifyWholeHousehold(
      householdId,
      `Couldn't read a transaction from a forwarded email ("${subject.slice(0, 80)}") — add it manually if it was a purchase.`
    );
    return NextResponse.json({ status: "unreadable" });
  }

  const where = alert.merchant ? ` at ${alert.merchant}` : "";
  if (alert.kind === "CREDIT") {
    await notifyWholeHousehold(
      householdId,
      `A forwarded email shows ${money(alert.currency ?? "", alert.amount)} credited${where}${
        alert.last4 ? ` on card ending ${alert.last4}` : ""
      } — refunds aren't added automatically; record it if needed.`
    );
    return NextResponse.json({ status: "credit-skipped" });
  }

  const instruments = await prisma.paymentInstrument.findMany({
    where: { householdId, archived: false },
    select: { id: true, name: true, currency: true, last4: true, type: true },
  });
  const instrument = alert.last4 ? instruments.find((i) => i.last4 === alert.last4) : undefined;
  if (!instrument) {
    await notifyWholeHousehold(
      householdId,
      alert.last4
        ? `A forwarded email shows ${money(alert.currency ?? "", alert.amount)}${where} on a card ending ${alert.last4}, but no account has those last 4 digits. Add them on the Instruments page, then add this one manually.`
        : `A forwarded email shows ${money(alert.currency ?? "", alert.amount)}${where}, but doesn't say which card. Add it manually.`
    );
    return NextResponse.json({ status: "unknown-card" });
  }

  const currency = alert.currency ?? instrument.currency;
  const dateStr =
    alert.date ?? (payload.Date ? new Date(payload.Date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const date = new Date(`${dateStr}T00:00:00Z`);

  // Same card, day and amount already recorded (e.g. the alert was forwarded
  // twice, or the statement was imported first) -- don't add it again.
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const existing = await prisma.transaction.findFirst({
    where: { householdId, instrumentId: instrument.id, amount: alert.amount, date: { gte: date, lt: nextDay } },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ status: "duplicate" });

  const [suggestion] = await suggestCategories(householdId, [alert.merchant ?? subject]);
  const category =
    (suggestion &&
      (await prisma.transactionCategory.findFirst({
        where: { id: suggestion.categoryId, householdId },
        select: { id: true, name: true },
      }))) ||
    (await prisma.transactionCategory.findFirst({
      where: { householdId, direction: "EXPENSE", name: "Other Expense" },
      select: { id: true, name: true },
    })) ||
    (await prisma.transactionCategory.findFirst({
      where: { householdId, direction: "EXPENSE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }));
  const owner =
    (await prisma.user.findFirst({ where: { householdId, role: "ADMIN" }, select: { id: true } })) ??
    (await prisma.user.findFirst({ where: { householdId }, select: { id: true } }));
  if (!category || !owner) return NextResponse.json({ status: "no-category-or-user" });

  await prisma.$transaction(async (tx) => {
    // Recorded as a one-row import so it shows in Import history and is
    // labelled "imported" on the Dashboard.
    const batch = await tx.importBatch.create({
      data: {
        fileName: `Email: ${subject || "bank alert"}`.slice(0, 255),
        currency,
        rowsInFile: 1,
        importedCount: 1,
        duplicateCount: 0,
        periodStart: date,
        periodEnd: date,
        householdId,
        instrumentId: instrument.id,
        createdById: owner.id,
      },
    });
    await tx.transaction.create({
      data: {
        amount: alert.amount,
        currency,
        date,
        notes: alert.merchant ?? subject.slice(0, 200),
        categoryId: category.id,
        instrumentId: instrument.id,
        householdId,
        createdById: owner.id,
        importBatchId: batch.id,
      },
    });
  });

  await notifyWholeHousehold(
    householdId,
    `Added from email: ${money(currency, alert.amount)}${where} on ${instrument.name} (${category.name}${
      suggestion ? "" : " — check the category"
    }).`
  );
  return NextResponse.json({ status: "added" });
}
