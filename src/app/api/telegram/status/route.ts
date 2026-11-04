import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { linkCode, telegramApi, telegramConfigured, webhookSecretUsable } from "@/lib/telegram";

// What Settings needs to show the Telegram bot section: whether the env vars
// are in place, the bot's username, whether the app is registered with
// Telegram, this member's link code and how many chats they've linked.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!telegramConfigured()) return NextResponse.json({ configured: false });

  const [me, webhook, linkedChats] = await Promise.all([
    telegramApi<{ username: string }>("getMe", {}),
    telegramApi<{ url: string; last_error_message?: string }>("getWebhookInfo", {}),
    prisma.telegramLink.count({ where: { userId: user.id } }),
  ]);

  return NextResponse.json({
    configured: true,
    secretUsable: webhookSecretUsable(),
    tokenValid: !!me,
    botUsername: me?.username ?? null,
    connected: !!webhook?.url && webhook.url.endsWith("/api/telegram/webhook"),
    lastError: webhook?.last_error_message ?? null,
    linkCode: linkCode(user.id),
    linkedChats,
  });
}
