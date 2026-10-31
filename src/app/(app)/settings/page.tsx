"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Analytics } from "@vercel/analytics/next"
import { GMAIL_LABEL, buildGmailScript } from "@/lib/gmailScript";

export default function SettingsPage() {
  const { data: session } = useSession();
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // undefined while loading; token null means INBOUND_EMAIL_SECRET isn't set.
  const [inbound, setInbound] = useState<{ token: string | null; address: string | null } | undefined>(undefined);
  const [copied, setCopied] = useState<"script" | "address" | null>(null);

  useEffect(() => {
    fetch("/api/auth/mfa/status")
      .then((r) => r.json())
      .then((d) => {
        setMfaEnabled(d.mfaEnabled);
        setLoading(false);
      });
    fetch("/api/inbound/address")
      .then((r) => (r.ok ? r.json() : { token: null, address: null }))
      .then(setInbound)
      .catch(() => setInbound({ token: null, address: null }));
  }, []);

  const gmailScript = inbound?.token ? buildGmailScript(window.location.origin, inbound.token) : null;

  async function copy(what: "script" | "address", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard blocked -- the text is still selectable on screen.
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
        <h2 className="mb-1 text-sm font-medium text-gray-700">Add transactions from Gmail</h2>
        <p className="mb-3 text-sm text-gray-500">
          A small script in your own Gmail sends your bank&apos;s card alert emails here every 10 minutes, and each
          purchase is added automatically — matched to the card by its last 4 digits and categorized from your past
          transactions. You&apos;ll get a notification for each one, and for any alert that couldn&apos;t be added.
        </p>
        {inbound === undefined ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : !gmailScript ? (
          <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-500">
            Not set up on this server yet — add an <code>INBOUND_EMAIL_SECRET</code> environment variable (any long
            random string) in Vercel and redeploy.
          </p>
        ) : (
          <div className="space-y-3">
            <ol className="list-decimal space-y-2 pl-5 text-xs text-gray-600">
              <li>
                <span className="font-medium">Label your alerts.</span> In Gmail, search for one of your bank&apos;s
                alert emails, open the search options (the sliders icon) → <em>Create filter</em> → tick{" "}
                <em>Apply the label</em> and choose a new label named <code>{GMAIL_LABEL}</code>. Repeat for each bank.
                Leave <em>also apply to matching conversations</em> unticked so old alerts aren&apos;t added.
              </li>
              <li>
                <span className="font-medium">Add the script.</span> Open{" "}
                <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                  script.google.com
                </a>{" "}
                (signed in to that Gmail), delete the sample code, paste the script below, and click Save.
              </li>
              <li>
                <span className="font-medium">Switch it on.</span> In the toolbar, choose the <code>setup</code>{" "}
                function and click <em>Run</em>. Google will say the app isn&apos;t verified — that&apos;s expected for
                your own script: click <em>Advanced</em> → <em>Go to … (unsafe)</em> → <em>Allow</em>.
              </li>
              <li>Make sure each card&apos;s last 4 digits are set on the Instruments page.</li>
            </ol>

            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">Your script</span>
              <button
                onClick={() => copy("script", gmailScript)}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                {copied === "script" ? "Copied" : "Copy script"}
              </button>
            </div>
            <pre className="max-h-48 overflow-auto rounded-md bg-gray-50 p-3 text-[11px] leading-snug">{gmailScript}</pre>
            <p className="text-xs text-gray-400">
              Keep the script private — its token lets it add transactions to your household. Other family members
              can use the same script in their own Gmail. Mail from Outlook or other accounts: auto-forward those
              alerts to this Gmail.
            </p>

            {inbound.address && (
              <div className="border-t pt-3">
                <p className="mb-1 text-xs text-gray-500">Or forward alerts by email (Postmark) to:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-md bg-gray-50 px-3 py-2 text-xs">{inbound.address}</code>
                  <button
                    onClick={() => copy("address", inbound.address!)}
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-gray-50"
                  >
                    {copied === "address" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
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
