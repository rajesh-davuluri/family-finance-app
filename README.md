# Family Finance App

A multi-user (household) personal finance tracker built with **Next.js 15 (App Router) + TypeScript + Prisma + SQL Server**. Rebuilt from scratch — see "What's different from the previous version" below.

## Features

- **Multi-user households** — each household shares one ledger; members join by invite code
- **Auth** — email/password (bcrypt-hashed) with optional TOTP two-factor authentication (Google Authenticator, Authy, etc.)
- **Payment instruments** — bank accounts, credit cards, cash, tracked per currency
- **Categories** — income/expense categories, seeded with sensible defaults on signup
- **Transactions** — multi-currency, filterable, with notes
- **Recurring transactions** — templates that auto-generate real transactions on a schedule (or on-demand via a "Generate now" button)
- **Dashboard** — this-month income/expense/net, spending-by-category chart, 6-month trend, recent activity

## 1. Prerequisites

- Node.js 18.18+ (20 LTS recommended)
- SQL Server 2019+ (Express, Developer, or full edition — your existing local instance is fine), **or** an Azure SQL database for production
- Local SQL Server: **TCP/IP must be enabled** (SQL Server Configuration Manager → SQL Server Network Configuration → Protocols) — named-pipes-only setups won't accept Prisma's connection

## 2. Setup

```bash
npm install
cp .env.example .env      # then fill in the values — see below
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

App runs at `http://localhost:3000`.

## 3. Environment variables

See `.env.example` for the full annotated list. You need:

- **`DATABASE_URL`** — Windows Authentication works for local dev (no password needed); Azure SQL needs SQL authentication (username/password) for production
- **`NEXTAUTH_SECRET`** — generate with `npx auth secret`, or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- **`NEXTAUTH_URL`** — `http://localhost:3000` locally; your deployed URL in production
- **`FIELD_ENCRYPTION_KEY`** — encrypts TOTP MFA secrets at rest; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **`CRON_SECRET`** — any random string; protects the recurring-transaction generation endpoint

## 4. First-time use

1. Go to `/signup`, choose "New household," and create your account (you become the household Admin)
2. Add at least one **Payment instrument** (Instruments page) and confirm your **Categories** look right (defaults are pre-seeded)
3. Start adding transactions, or set up **Recurring templates** for bills/income that repeat
4. Share your household's **invite code** (Household page) with family members so they can join via "Join household" on the signup page
5. Optionally turn on **two-factor authentication** per account under Settings

## 5. Deploying publicly (Vercel + Azure SQL)

1. **Push this project to a GitHub repository.**
2. **Create an Azure SQL Database** (portal.azure.com → search "SQL databases" → Create). Use SQL authentication for the admin login (not Windows Auth — that only works on your own machine).
3. **Firewall**: on the SQL *server* (not the database) → Networking → allow "Azure services and resources to access this server," and optionally add your own IP if you want to run migrations from your PC.
4. **Get the connection string** from the database's "Connection strings" page and adapt it to Prisma's format:
   ```
   sqlserver://<server>.database.windows.net:1433;database=<dbname>;user=<admin-user>;password=<password>;encrypt=true
   ```
5. **Run migrations against it**: temporarily set `DATABASE_URL` to that string in your terminal, then `npx prisma migrate deploy`.
6. **Import into Vercel** (vercel.com → sign in with GitHub → Add New Project). Before deploying, add all the environment variables from step 3 above (using the Azure connection string, not your local one) under Project Settings → Environment Variables.
7. **Deploy.** Vercel gives you a free `https://your-project.vercel.app` URL.
8. **Recurring transactions on a schedule**: `vercel.json` already defines a daily cron hitting `/api/cron/generate-recurring` — just make sure `CRON_SECRET` is set as an environment variable on the Vercel project (same value the cron will send automatically).

## 6. Security notes — read before letting family use this for real

- This app will hold real financial data, reachable on the internet once deployed. Treat the admin database password and `NEXTAUTH_SECRET`/`FIELD_ENCRYPTION_KEY` as real secrets — never commit `.env`, never paste them into a shared screenshot or chat.
- Password hashing uses bcrypt with a reasonable cost factor; MFA secrets are encrypted at rest (AES-256-GCM) rather than stored in plaintext.
- There's no rate limiting on the login or signup endpoints in this build — worth adding (e.g. via a Vercel-compatible rate limiter) before wider real-world use, since brute-force login attempts aren't currently throttled.
- `npm audit` currently shows two remaining advisories, both low real-world risk for this app: one in a dev-only Prisma tooling dependency (not shipped to production), and one in a `postcss` copy bundled inside Next.js's own build tooling (build-time only, never touches user input at runtime). The critical/high-severity Next.js vulnerabilities from mid-2026 (including an unauthenticated RCE affecting Windows-hosted servers) are fixed by the Next.js 15.5.24 version pinned in `package.json` — don't downgrade below that without checking current advisories again.

## 7. What's different from the previous version

This is a ground-up rebuild, not a copy of the earlier app. Notable differences:

- Built on **Next.js 15** (the previous version was on 14) — picked up the current LTS with the mid-2026 critical security patches included
- Default categories are now created **per household at signup** rather than as shared global reference data
- Households join via a generated **invite code** rather than a separate invite-sending flow
- Recurring transactions are a first-class feature with a manual "Generate now" trigger, in addition to the Vercel Cron schedule

## 8. Project structure

```
prisma/schema.prisma       — data model (SQL Server–specific choices documented inline)
prisma/seed.ts             — connectivity sanity check (no shared seed data needed anymore)
src/lib/                   — Prisma client, auth config, encryption, cascade-delete helpers, enums, FX helper
src/app/(auth)/            — login, signup (no navbar)
src/app/(app)/             — dashboard, transactions, instruments, categories, recurring, household, settings (navbar + auth-gated)
src/app/api/                — all API routes
```

## 9. Known limitations / next steps you might want

- FX rates on the dashboard are a static approximation table (`src/lib/fx.ts`), not live — fine for a rough household view, not for anything requiring precision
- No OAuth (Google/GitHub) sign-in yet — only email/password. NextAuth is already wired up, so adding an OAuth provider is a config addition, not a rewrite
- No CSV/Excel import for historical transactions (the previous version had one built for a specific spreadsheet layout) — say the word if you want one built for your data
