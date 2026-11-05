import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { InlineButton, editMessage, sendMessage, telegramApi, userForLinkCode, webhookSecretValid } from "@/lib/telegram";
import { parseQuickEntry } from "@/lib/telegramParse";
import { suggestCategories } from "@/lib/categorize";
import { notifyHousehold } from "@/lib/notify";
import { todayInZone } from "@/lib/appTimezone";

// Telegram bot webhook. A linked member sends "450 swiggy hdfc" or pastes a
// bank alert; the bot replies with what it understood and buttons to add,
// change the card/category, or cancel. Nothing is recorded until "Add".
//
// Always answers 200 once the secret checks out -- Telegram retries anything
// else, which would only repeat the same reply.

const PENDING_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const HELP = `Send me a purchase and I'll add it to Family Finance after you confirm:

• 450 swiggy hdfc
• groceries 1200 amex yesterday
• ₹99 netflix 30/10
• or paste a bank SMS/email alert

I pick the card from its name or last 4 digits, and the category from your past transactions — you can change either before adding.

Screenshots: open the image in Google Photos (Lens → Copy text) or on iPhone long-press the text, copy it, and paste it here.

/unlink — disconnect this chat`;

type TgMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: unknown[];
  document?: unknown;
};
type TgCallback = { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
type TgUpdate = { message?: TgMessage; callback_query?: TgCallback };

export async function POST(req: Request) {
  if (!webhookSecretValid(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const update: TgUpdate = await req.json().catch(() => ({}));
  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
  } catch (err) {
    console.error("Telegram webhook error:", err);
  }
  return NextResponse.json({ ok: true });
}

async function handleMessage(msg: TgMessage) {
  const chatId = String(msg.chat.id);
  const text = (msg.text ?? msg.caption ?? "").trim();

  const command = text.match(/^\/(start|link)(?:@\w+)?\s*([a-f0-9]*)$/i);
  if (command) {
    const code = command[2];
    if (!code) {
      const linked = await prisma.telegramLink.findUnique({ where: { chatId } });
      await sendMessage(chatId, linked ? HELP : "To connect, open Family Finance → Settings → Telegram bot and tap “Open in Telegram”.");
      return;
    }
    const user = await userForLinkCode(code.toLowerCase());
    if (!user) {
      await sendMessage(chatId, "That link code isn't valid. Copy it again from Settings → Telegram bot.");
      return;
    }
    await prisma.telegramLink.upsert({
      where: { chatId },
      create: { chatId, userId: user.id, householdId: user.householdId },
      update: { userId: user.id, householdId: user.householdId },
    });
    await sendMessage(chatId, `Connected to ${user.name}'s Family Finance account ✅\n\n${HELP}`);
    return;
  }

  const link = await prisma.telegramLink.findUnique({ where: { chatId } });
  if (!link) {
    await sendMessage(chatId, "This chat isn't connected yet. Open Family Finance → Settings → Telegram bot and tap “Open in Telegram”.");
    return;
  }

  if (/^\/unlink\b/i.test(text)) {
    await prisma.telegramLink.delete({ where: { chatId } });
    await sendMessage(chatId, "Disconnected. Messages here won't be added any more.");
    return;
  }
  if (/^\/help\b/i.test(text) || (!text && !msg.photo && !msg.document)) {
    await sendMessage(chatId, HELP);
    return;
  }
  if (!text && (msg.photo || msg.document)) {
    await sendMessage(
      chatId,
      "I can't read images yet. Copy the text from the screenshot (Google Photos → Lens → Copy text, or long-press on iPhone) and paste it here."
    );
    return;
  }

  const [accounts, categories] = await Promise.all([
    prisma.paymentInstrument.findMany({
      where: { householdId: link.householdId, archived: false },
      select: { id: true, name: true, last4: true, currency: true },
      orderBy: { name: "asc" },
    }),
    prisma.transactionCategory.findMany({
      where: { householdId: link.householdId, direction: "EXPENSE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const draft = parseQuickEntry(text, accounts, categories, todayInZone());
  if (!draft) {
    await sendMessage(chatId, `I couldn't find an amount in that.\n\n${HELP}`);
    return;
  }
  if (draft.isRefund) {
    await sendMessage(chatId, "That looks like a refund or credit — those aren't added from Telegram yet. Please add it in the app.");
    return;
  }

  const instrumentId = draft.instrumentId ?? (accounts.length === 1 ? accounts[0].id : null);
  let categoryId = draft.categoryId;
  if (!categoryId && draft.notes) {
    const [suggestion] = await suggestCategories(link.householdId, [draft.notes]);
    if (suggestion && categories.some((c) => c.id === suggestion.categoryId)) categoryId = suggestion.categoryId;
  }
  if (!categoryId) categoryId = categories.find((c) => c.name === "Other Expense")?.id ?? null;

  // Clear out drafts nobody acted on.
  await prisma.pendingTelegramTransaction.deleteMany({
    where: { householdId: link.householdId, createdAt: { lt: new Date(Date.now() - PENDING_TTL_MS) } },
  });

  const pending = await prisma.pendingTelegramTransaction.create({
    data: {
      chatId,
      householdId: link.householdId,
      userId: link.userId,
      amount: draft.amount,
      currency: draft.currency ?? "",
      date: new Date(`${draft.date}T00:00:00Z`),
      notes: draft.notes,
      instrumentId,
      categoryId,
    },
  });
  const view = await summary(pending.id);
  if (view) await sendMessage(chatId, view.text, view.buttons);
}

type Pending = NonNullable<Awaited<ReturnType<typeof loadPending>>>;

function loadPending(id: string) {
  return prisma.pendingTelegramTransaction.findUnique({ where: { id } });
}

async function listsFor(householdId: string) {
  const [accounts, categories] = await Promise.all([
    prisma.paymentInstrument.findMany({
      where: { householdId, archived: false },
      select: { id: true, name: true, last4: true, currency: true },
      orderBy: { name: "asc" },
    }),
    prisma.transactionCategory.findMany({
      where: { householdId, direction: "EXPENSE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { accounts, categories };
}

function grid(buttons: InlineButton[], perRow = 2): InlineButton[][] {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow));
  return rows;
}

async function summary(pendingId: string) {
  const p = await loadPending(pendingId);
  if (!p) return null;
  const { accounts, categories } = await listsFor(p.householdId);
  const account = accounts.find((a) => a.id === p.instrumentId);
  const category = categories.find((c) => c.id === p.categoryId);
  const currency = p.currency || account?.currency || "";
  const date = p.date.toISOString().slice(0, 10);

  let duplicate = false;
  if (account) {
    const day = new Date(`${date}T00:00:00Z`);
    const next = new Date(day);
    next.setUTCDate(next.getUTCDate() + 1);
    duplicate = !!(await prisma.transaction.findFirst({
      where: { householdId: p.householdId, instrumentId: account.id, amount: p.amount, date: { gte: day, lt: next } },
      select: { id: true },
    }));
  }

  const lines = [
    `${currency ? `${currency} ` : ""}${Number(p.amount).toFixed(2)}${p.notes ? ` · ${p.notes}` : ""}`,
    `📅 ${date}`,
    account ? `💳 ${account.name}${account.last4 ? ` ••${account.last4}` : ""}` : "💳 Which card? Tap “Card” below.",
    category ? `🏷 ${category.name}` : "🏷 Which category? Tap “Category” below.",
  ];
  if (duplicate) lines.push("\n⚠️ A transaction with the same card, date and amount is already recorded.");

  const buttons: InlineButton[][] = [];
  if (account && category) buttons.push([{ text: "✅ Add", callback_data: `a:${p.id}` }]);
  buttons.push([
    { text: "💳 Card", callback_data: `pc:${p.id}` },
    { text: "🏷 Category", callback_data: `pk:${p.id}` },
  ]);
  buttons.push([{ text: "❌ Cancel", callback_data: `x:${p.id}` }]);
  return { text: lines.join("\n"), buttons };
}

async function handleCallback(cb: TgCallback) {
  const chatId = cb.message ? String(cb.message.chat.id) : null;
  const messageId = cb.message?.message_id;
  const [action, pendingId, indexStr] = (cb.data ?? "").split(":");
  await telegramApi("answerCallbackQuery", { callback_query_id: cb.id });
  if (!chatId || !messageId || !pendingId) return;

  const p = await loadPending(pendingId);
  // Only the chat that created a draft can act on it.
  if (!p || p.chatId !== chatId) {
    await editMessage(chatId, messageId, "This one has expired or was already handled. Send it again if needed.");
    return;
  }
  const { accounts, categories } = await listsFor(p.householdId);
  const index = Number(indexStr);

  switch (action) {
    case "x":
      await prisma.pendingTelegramTransaction.delete({ where: { id: p.id } });
      await editMessage(chatId, messageId, "❌ Cancelled — nothing was added.");
      return;
    case "pc":
      await editMessage(
        chatId,
        messageId,
        "Which card or account?",
        [...grid(accounts.map((a, i) => ({ text: a.last4 ? `${a.name} ••${a.last4}` : a.name, callback_data: `c:${p.id}:${i}` }))), [{ text: "↩ Back", callback_data: `b:${p.id}` }]]
      );
      return;
    case "pk":
      await editMessage(
        chatId,
        messageId,
        "Which category?",
        [...grid(categories.map((c, i) => ({ text: c.name, callback_data: `k:${p.id}:${i}` }))), [{ text: "↩ Back", callback_data: `b:${p.id}` }]]
      );
      return;
    case "c":
      if (accounts[index]) await prisma.pendingTelegramTransaction.update({ where: { id: p.id }, data: { instrumentId: accounts[index].id } });
      break;
    case "k":
      if (categories[index]) await prisma.pendingTelegramTransaction.update({ where: { id: p.id }, data: { categoryId: categories[index].id } });
      break;
    case "a":
      await add(p, chatId, messageId, accounts, categories);
      return;
  }

  // "b" (back) and after picking a card/category: show the summary again.
  const view = await summary(p.id);
  if (view) await editMessage(chatId, messageId, view.text, view.buttons);
}

async function add(
  p: Pending,
  chatId: string,
  messageId: number,
  accounts: { id: string; name: string; currency: string }[],
  categories: { id: string; name: string }[]
) {
  const account = accounts.find((a) => a.id === p.instrumentId);
  const category = categories.find((c) => c.id === p.categoryId);
  if (!account || !category) {
    const view = await summary(p.id);
    if (view) await editMessage(chatId, messageId, view.text, view.buttons);
    return;
  }
  const currency = p.currency || account.currency;

  // Removing the draft and adding the transaction happen together: a
  // double-tap finds the draft already gone and adds nothing, and a failed
  // insert keeps the draft so "Add" can be tapped again.
  const added = await prisma.$transaction(async (tx) => {
    const removed = await tx.pendingTelegramTransaction.deleteMany({ where: { id: p.id } });
    if (removed.count === 0) return false;
    await tx.transaction.create({
      data: {
        amount: p.amount,
        currency,
        date: p.date,
        notes: p.notes,
        categoryId: category.id,
        instrumentId: account.id,
        householdId: p.householdId,
        createdById: p.userId,
      },
    });
    return true;
  });
  if (!added) return;

  const amount = `${currency} ${Number(p.amount).toFixed(2)}`;
  await editMessage(
    chatId,
    messageId,
    `✅ Added ${amount}${p.notes ? ` · ${p.notes}` : ""}\n💳 ${account.name} · 🏷 ${category.name} · 📅 ${p.date.toISOString().slice(0, 10)}`
  );
  const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { name: true } });
  await notifyHousehold(p.householdId, p.userId, `${user?.name ?? "Someone"} added ${amount} ${category.name} on ${account.name} via Telegram`);
}
