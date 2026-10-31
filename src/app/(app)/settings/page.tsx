"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Analytics } from "@vercel/analytics/next"

export default function SettingsPage() {
  const { data: session } = useSession();
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forwardingAddress, setForwardingAddress] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/auth/mfa/status")
      .then((r) => r.json())
      .then((d) => {
        setMfaEnabled(d.mfaEnabled);
        setLoading(false);
      });
    fetch("/api/inbound/address")
      .then((r) => (r.ok ? r.json() : { address: null }))
      .then((d) => setForwardingAddress(d.address))
      .catch(() => setForwardingAddress(null));
  }, []);

  async function copyAddress() {
    if (!forwardingAddress) return;
    try {
      await navigator.clipboard.writeText(forwardingAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked -- the address is still selectable on screen.
    }
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
        <h2 className="mb-1 text-sm font-medium text-gray-700">Add transactions by email</h2>
        <p className="mb-3 text-sm text-gray-500">
          Forward your bank&apos;s card alert emails here and each purchase is added automatically — matched to the
          card by its last 4 digits and categorized from your past transactions. You&apos;ll get a notification for
          each one, and for any email that couldn&apos;t be added.
        </p>
        {forwardingAddress === undefined ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : forwardingAddress === null ? (
          <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-500">
            Not set up on this server yet — the inbound email settings (POSTMARK_INBOUND_ADDRESS, INBOUND_EMAIL_SECRET,
            INBOUND_WEBHOOK_USER, INBOUND_WEBHOOK_PASSWORD) need to be added in Vercel.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-md bg-gray-50 px-3 py-2 text-xs">{forwardingAddress}</code>
              <button onClick={copyAddress} className="rounded-md border px-3 py-1.5 text-xs hover:bg-gray-50">
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-500">
              <li>
                In Gmail: Settings → See all settings → Forwarding and POP/IMAP → <em>Add a forwarding address</em>, and
                paste the address above.
              </li>
              <li>Gmail sends a confirmation code — it appears in this app&apos;s notifications (the bell). Enter it in Gmail.</li>
              <li>
                Create a filter (Settings → Filters) for emails from your bank&apos;s alert address, with{" "}
                <em>Forward it to</em> this address. Only forward card alerts, not all your mail.
              </li>
              <li>Make sure each card&apos;s last 4 digits are set on the Instruments page.</li>
            </ol>
            <p className="text-xs text-gray-400">Keep this address private — anything sent to it is treated as your household&apos;s.</p>
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
              Can't scan? Enter this key manually: <code className="rounded bg-gray-100 px-1">{secret}</code>
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
