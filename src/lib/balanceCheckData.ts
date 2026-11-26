import { prisma } from "@/lib/prisma";
import { balanceItems, computeInstrumentBalance } from "@/lib/balanceCalculations";
import { explainGap, isMatch, type CheckItem } from "@/lib/balanceCheck";
import { money } from "@/lib/money";

// The latest balance check on each account, re-tested now: the bank's figure
// for that date against what the app works out for the same date today. An
// entry added, changed or deleted since the check shows up as a difference.

export type CheckStatus = {
  asOfDate: string;
  checkedAt: string;
  bankBalance: number;
  appBalance: number; // for asOfDate, as the records stand now
  diff: number; // bank minus app
  matched: boolean;
  adjusted: boolean;
  daysSince: number; // since the check was made
  // Where the difference most likely is, when there is one (explainGap).
  likely: string | null;
};

type Account = { id: string; currency: string; openingBalance: unknown; openingBalanceDate: Date | null };

export async function loadCheckStatuses(accounts: Account[]): Promise<Map<string, CheckStatus>> {
  const out = new Map<string, CheckStatus>();
  if (!accounts.length) return out;
  const checks = await prisma.balanceCheck.findMany({ where: { instrumentId: { in: accounts.map((a) => a.id) } }, orderBy: { createdAt: "desc" } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const c of checks) {
    if (out.has(c.instrumentId)) continue; // newest first
    const a = byId.get(c.instrumentId);
    if (!a || a.openingBalance === null || !a.openingBalanceDate) continue;
    const bank = Number(c.bankBalance);
    const app = await computeInstrumentBalance(a.id, Number(a.openingBalance), a.openingBalanceDate, c.asOfDate);
    const diff = Math.round((bank - app) * 100) / 100;
    const asOf = c.asOfDate.toISOString().slice(0, 10);
    let likely: string | null = null;
    if (!isMatch(bank, app)) {
      const items = (await balanceItems(a.id, a.openingBalanceDate)).filter((i) => i.date <= asOf);
      likely = explainGap({
        diff,
        checkedDiff: Math.round((bank - Number(c.appBalance)) * 100) / 100,
        checkedOn: c.createdAt.toISOString().slice(0, 10),
        asOf,
        since: a.openingBalanceDate.toISOString().slice(0, 10),
        items,
        addedSince: await addedAfter(a.id, a.openingBalanceDate, c.asOfDate, c.createdAt, items),
        money: (n) => money(n, a.currency),
      });
    }
    out.set(c.instrumentId, {
      asOfDate: c.asOfDate.toISOString().slice(0, 10),
      checkedAt: c.createdAt.toISOString(),
      bankBalance: bank,
      appBalance: app,
      diff,
      matched: isMatch(bank, app),
      adjusted: c.adjusted,
      daysSince: Math.floor((Date.now() - c.createdAt.getTime()) / 86_400_000),
      likely,
    });
  }
  return out;
}

// Of `items`, the ones recorded after `checkedAt` (dated from `since` to `asOf`).
export async function addedAfter(instrumentId: string, since: Date, asOf: Date, checkedAt: Date, items: CheckItem[]): Promise<CheckItem[]> {
  const where = { date: { gte: since, lte: asOf }, createdAt: { gt: checkedAt } };
  const [txns, transfers] = await Promise.all([
    prisma.transaction.findMany({ where: { instrumentId, ...where }, select: { id: true } }),
    prisma.transfer.findMany({ where: { OR: [{ fromInstrumentId: instrumentId }, { toInstrumentId: instrumentId }], ...where }, select: { id: true } }),
  ]);
  const ids = new Set([...txns, ...transfers].map((x) => x.id));
  return items.filter((i) => ids.has(i.id));
}
