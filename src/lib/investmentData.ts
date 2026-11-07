// Server-side helpers for investments: ownership checks, input schemas and
// the JSON the Investments page reads.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Currency } from "@/lib/enums";
import { AccountKind, AssetType, Country, Exchange, TradeType, type Fx, type HoldingInput } from "@/lib/investments";
import { getDefaultRate } from "@/lib/fx";

const text = (max = 200) => z.string().trim().max(max).nullable().optional();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const accountFields = z.object({
  name: z.string().trim().min(1).max(200),
  broker: text(),
  country: Country,
  currency: Currency,
  kind: AccountKind,
  owner: text(),
  loginNote: text(2000),
  notes: text(10000),
  archived: z.boolean().optional(),
});

export const tradeFields = z
  .object({
    type: TradeType,
    date: ymd,
    quantity: z.number().positive().nullable().optional(),
    price: z.number().nonnegative().nullable().optional(),
    fees: z.number().nonnegative().nullable().optional(),
    amount: z.number().positive().nullable().optional(),
    notes: text(2000),
  })
  .refine((t) => (t.type === "DIVIDEND" ? !!t.amount : !!t.quantity && t.price !== undefined && t.price !== null), {
    message: "A buy or sale needs a quantity and price; a dividend needs an amount.",
  });

export const holdingFields = z.object({
  accountId: z.string(),
  symbol: z.string().trim().min(1).max(40),
  name: text(),
  exchange: Exchange,
  assetType: AssetType,
  sector: text(100),
  currency: Currency.optional(),
  price: z.number().positive().nullable().optional(), // typed-in price
  notes: text(10000),
  firstTrade: tradeFields.optional(),
});

export async function accountOf(id: string, householdId: string) {
  const a = await prisma.investmentAccount.findUnique({ where: { id } });
  return a && a.householdId === householdId ? a : null;
}

export async function holdingOf(id: string, householdId: string) {
  const h = await prisma.holding.findUnique({ where: { id }, include: { account: true } });
  return h && h.account.householdId === householdId ? h : null;
}

export function tradeData(t: z.infer<typeof tradeFields>) {
  return {
    type: t.type,
    date: new Date(`${t.date}T00:00:00Z`),
    quantity: t.type === "DIVIDEND" ? null : (t.quantity ?? null),
    price: t.type === "DIVIDEND" ? null : (t.price ?? null),
    fees: t.fees ?? null,
    amount: t.type === "DIVIDEND" ? (t.amount ?? null) : null,
    notes: t.notes?.trim() || null,
  };
}

// The USD/INR rate: the last one fetched with prices, else the app's
// approximate rate.
export async function currentFx(): Promise<Fx & { updatedAt: string | null; live: boolean }> {
  const r = await prisma.marketRate.findUnique({ where: { pair: "USDINR" } }).catch(() => null);
  if (r) return { USDINR: Number(r.rate), updatedAt: r.updatedAt.toISOString(), live: true };
  return { USDINR: 1 / getDefaultRate("INR"), updatedAt: null, live: false };
}

export const accountInclude = {
  holdings: { include: { trades: { orderBy: { date: "asc" } } }, orderBy: { symbol: "asc" } },
} satisfies Prisma.InvestmentAccountInclude;

type AccountRow = Prisma.InvestmentAccountGetPayload<{ include: typeof accountInclude }>;
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const day = (d: Date) => d.toISOString().slice(0, 10);

export function accountJson(a: AccountRow) {
  return {
    ...a,
    holdings: a.holdings.map((h) => ({
      ...h,
      lastPrice: num(h.lastPrice),
      trades: h.trades.map((t) => ({ ...t, date: day(t.date), quantity: num(t.quantity), price: num(t.price), fees: num(t.fees), amount: num(t.amount) })),
    })),
  };
}

// The analysis input for every open account's holdings.
export function holdingInputs(accounts: ReturnType<typeof accountJson>[]): HoldingInput[] {
  return accounts
    .filter((a) => !a.archived)
    .flatMap((a) =>
      a.holdings.map((h) => ({
        id: h.id,
        symbol: h.symbol,
        name: h.name,
        exchange: h.exchange,
        assetType: h.assetType,
        sector: h.sector,
        currency: h.currency,
        country: a.country,
        accountId: a.id,
        accountName: a.name,
        price: h.lastPrice,
        priceAt: h.lastPriceAt ? h.lastPriceAt.toISOString() : null,
        priceSource: h.priceSource,
        trades: h.trades,
      })),
    );
}

export async function householdAccounts(householdId: string) {
  const accounts = await prisma.investmentAccount.findMany({
    where: { householdId },
    include: accountInclude,
    orderBy: [{ archived: "asc" }, { country: "asc" }, { name: "asc" }],
  });
  return accounts.map(accountJson);
}
