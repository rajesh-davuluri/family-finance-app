import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Thin wrapper over the Telegram Bot API, plus the codes members use to link
// their Telegram chat to their account. Configured by two env vars:
//   TELEGRAM_BOT_TOKEN      -- from @BotFather
//   TELEGRAM_WEBHOOK_SECRET -- any long random string; Telegram echoes it
//                              in a header on every webhook call, and link
//                              codes are derived from it

export function telegramConfigured() {
  return !!process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").length >= 16;
}

export type InlineButton = { text: string; callback_data: string };

export async function telegramApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) {
      console.error(`Telegram ${method} failed:`, json.description);
      return null;
    }
    return json.result as T;
  } catch (err) {
    console.error(`Telegram ${method} failed:`, err);
    return null;
  }
}

export function sendMessage(chatId: string, text: string, buttons?: InlineButton[][]) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export function editMessage(chatId: string, messageId: number, text: string, buttons?: InlineButton[][]) {
  return telegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: { inline_keyboard: buttons ?? [] },
  });
}

export function webhookSecretValid(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return expected.length >= 16 && got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// Telegram only allows A-Z, a-z, 0-9, _ and - in the secret_token header.
export function webhookSecretUsable() {
  return /^[A-Za-z0-9_-]{16,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET ?? "");
}

const LINK_CODE_LENGTH = 10;

// A member's link code, shown on Settings and sent to the bot as
// "/start <code>". Derived rather than stored.
export function linkCode(userId: string): string | null {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(`telegram-link:${userId}`).digest("hex").slice(0, LINK_CODE_LENGTH);
}

export async function userForLinkCode(code: string) {
  if (!/^[a-f0-9]+$/.test(code) || code.length !== LINK_CODE_LENGTH) return null;
  const users = await prisma.user.findMany({ select: { id: true, name: true, householdId: true } });
  return users.find((u) => linkCode(u.id) === code) ?? null;
}
