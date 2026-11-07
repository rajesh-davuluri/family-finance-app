"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type TelegramStatus =
  | { configured: false }
  | {
      configured: true;
      secretUsable: boolean;
      tokenValid: boolean;
      botUsername: string | null;
      connected: boolean;
      lastError: string | null;
      linkCode: string | null;
      linkedChats: number;
    };

export default function SettingsPage() {
  const { data: session } = useSession();
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [telegram, setTelegram] = useState<TelegramStatus | null | undefined>(undefined);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/mfa/status")
      .then((r) => r.json())
      .then((d) => {
        setMfaEnabled(d.mfaEnabled);
        setLoading(false);
      });
    loadTelegram();
  }, []);

  function loadTelegram() {
    fetch("/api/telegram/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setTelegram)
      .catch(() => setTelegram(null));
  }

  async function connectTelegram() {
    setTelegramBusy(true);
    setTelegramMessage(null);
    const res = await fetch("/api/telegram/connect", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setTelegramBusy(false);
    setTelegramMessage(res.ok ? "Bot connected." : body.error ?? "Couldn't connect the bot.");
    loadTelegram();
  }

  async function startSetup() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
    const body = await res.json();
    setBusy(false);
    if (res.ok) {
      setQrDataUrl(body.qrDataUrl);
      setSecret(body.secret);
    } else {
      setMessage(body.error ?? "Couldn't start MFA setup.");
    }
  }

  async function verifyCode() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: code }),
    });
    const body = await res.json();
    setBusy(false);
    if (res.ok) {
      setMfaEnabled(true);
      setQrDataUrl(null);
      setSecret(null);
      setCode("");
      setMessage("Two-factor authentication is now enabled.");
    } else {
      setMessage(body.error ?? "That code didn't verify — try again.");
    }
  }

  async function disable() {
    if (!confirm("Turn off two-factor authentication for your account?")) return;
    setBusy(true);
    await fetch("/api/auth/mfa/disable", { method: "POST" });
    setBusy(false);
    setMfaEnabled(false);
    setMessage("Two-factor authentication turned off.");
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-1 text-sm font-medium text-gray-700">Account</h2>
        <p className="text-sm text-gray-500">{session?.user?.name}</p>
        <p className="text-sm text-gray-500">{session?.user?.email}</p>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-1 text-sm font-medium text-gray-700">Telegram bot</h2>
        <p className="mb-3 text-sm text-gray-500">
          Send purchases to your own Telegram bot — “450 swiggy hdfc”, or paste a bank alert — and add them with one
          tap after checking the card and category.
        </p>
        {telegram === undefined ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : telegram === null || !telegram.configured ? (
          <div className="space-y-1 rounded-md bg-gray-50 p-3 text-xs text-gray-500">
            <p>Not set up on this server yet:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                In Telegram, message <span className="font-medium">@BotFather</span>, send <code>/newbot</code>, pick a
                name and a username ending in “bot”, and copy the token it gives you.
              </li>
              <li>
                In Vercel → Environment Variables, add <code>TELEGRAM_BOT_TOKEN</code> (that token) and{" "}
                <code>TELEGRAM_WEBHOOK_SECRET</code> (a long random string of letters and numbers only), then redeploy.
              </li>
            </ol>
          </div>
        ) : !telegram.tokenValid ? (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Telegram didn&apos;t accept TELEGRAM_BOT_TOKEN — copy it again from @BotFather, update it in Vercel and
            redeploy.
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            {!telegram.connected ? (
              <div className="space-y-2">
                <p className="text-gray-600">
                  Step 1 — connect <span className="font-medium">@{telegram.botUsername}</span> to this app (once for
                  the household):
                </p>
                <button
                  onClick={connectTelegram}
                  disabled={telegramBusy || !telegram.secretUsable}
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {telegramBusy ? "Connecting..." : "Connect bot"}
                </button>
                {!telegram.secretUsable && (
                  <p className="text-xs text-red-600">
                    TELEGRAM_WEBHOOK_SECRET may only contain letters, numbers, _ and - (at least 16 characters).
                  </p>
                )}
              </div>
            ) : (
              <p className="text-income-600">
                ✓ @{telegram.botUsername} is connected.
                {telegram.lastError && (
                  <span className="block text-xs text-amber-700">Last delivery problem: {telegram.lastError}</span>
                )}
              </p>
            )}
            {telegram.connected && telegram.linkCode && (
              <div className="space-y-2">
                <p className="text-gray-600">
                  {telegram.linkedChats > 0
                    ? `✓ Your Telegram is linked (${telegram.linkedChats} chat${telegram.linkedChats === 1 ? "" : "s"}). To link another device or account:`
                    : "Step 2 — link your Telegram account:"}
                </p>
                <a
                  href={`https://t.me/${telegram.botUsername}?start=${telegram.linkCode}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Open in Telegram
                </a>
                <p className="text-xs text-gray-400">
                  Then tap <em>Start</em>. Or send the bot: <code>/start {telegram.linkCode}</code>. Each family member
                  links from their own Settings page.
                </p>
              </div>
            )}
            {telegramMessage && <p className="text-xs text-gray-500">{telegramMessage}</p>}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-1 text-sm font-medium text-gray-700">Two-factor authentication</h2>
        <p className="mb-3 text-sm text-gray-500">
          Require a code from an authenticator app (Google Authenticator, Authy, 1Password, etc.) in addition to your
          password when signing in.
        </p>

        {mfaEnabled ? (
          <div className="space-y-3">
            <p className="text-sm text-green-600">Enabled on your account.</p>
            <button
              onClick={disable}
              disabled={busy}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        ) : qrDataUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Scan this with your authenticator app:</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="MFA QR code" className="h-40 w-40" />
            <p className="text-xs text-gray-400">
              Can&apos;t scan? Enter this key manually: <code className="rounded bg-gray-100 px-1">{secret}</code>
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-32 rounded-md border px-3 py-2 text-sm"
              />
              <button
                onClick={verifyCode}
                disabled={busy}
                className="rounded-md bg-brand-600 px-3 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Verify & enable
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={startSetup}
            disabled={busy}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Set up two-factor authentication
          </button>
        )}
        {message && <p className="mt-3 text-sm text-gray-600">{message}</p>}
      </div>
    </div>
  );
}
