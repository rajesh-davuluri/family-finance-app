import { prisma } from "@/lib/prisma";
import { computeInstrumentBalance } from "@/lib/balanceCalculations";
import { isMatch } from "@/lib/balanceCheck";

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
};

type Account = { id: string; openingBalance: unknown; openingBalanceDate: Date | null };

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
    out.set(c.instrumentId, {
      asOfDate: c.asOfDate.toISOString().slice(0, 10),
      checkedAt: c.createdAt.toISOString(),
      bankBalance: bank,
      appBalance: app,
      diff: Math.round((bank - app) * 100) / 100,
      matched: isMatch(bank, app),
      adjusted: c.adjusted,
      daysSince: Math.floor((Date.now() - c.createdAt.getTime()) / 86_400_000),
    });
  }
  return out;
}
