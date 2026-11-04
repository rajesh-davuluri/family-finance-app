import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { telegramApi, telegramConfigured, webhookSecretUsable } from "@/lib/telegram";

// Registers this app's webhook with Telegram (the "Connect bot" button on
// Settings), so nobody has to call the Bot API by hand. Safe to repeat.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!telegramConfigured()) return NextResponse.json({ error: "Telegram isn't configured on this server." }, { status: 400 });
  if (!webhookSecretUsable()) {
    return NextResponse.json(
      { error: "TELEGRAM_WEBHOOK_SECRET may only contain letters, numbers, _ and - (16+ characters)." },
      { status: 400 }
    );
  }

  const origin = new URL(req.url).origin;
  const ok = await telegramApi("setWebhook", {
    url: `${origin}/api/telegram/webhook`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  if (!ok) return NextResponse.json({ error: "Telegram rejected the setup — check TELEGRAM_BOT_TOKEN." }, { status: 502 });

  await telegramApi("setMyCommands", {
    commands: [
      { command: "help", description: "How to add a transaction" },
      { command: "unlink", description: "Disconnect this chat" },
    ],
  });
  return NextResponse.json({ ok: true });
}
