import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { calendarDateInZone } from "@/lib/appTimezone";
import { toApproxUsd } from "@/lib/fx";
import { kindOf, countsAsSpending, flowOf } from "@/lib/categoryKind";
import { balanceItems, computeInstrumentBalance } from "@/lib/balanceCalculations";
import { emergencyFund, fundPace, isEssential, monthsBefore, PACE_MONTHS } from "@/lib/emergencyFund";

// The emergency fund: money set aside for emergencies against the
// household's essential spending, averaged over the last six full months.
// The fund is a US bank account named "Emergency..." when there is one (its
// live balance), else the amount typed in on the dashboard plus the money
// added and taken out since (EmergencyFundEntry). Checking accounts are
// shown for context but not counted: that money pays the bills.
const EMERGENCY_ACCOUNT = /emergency/i;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const household = await prisma.household.findUnique({ where: { id: user.householdId }, select: { emergencyFundUsd: true, emergencyTargetMonths: true } });
  const target = household?.emergencyTargetMonths ?? 6;
  const today = calendarDateInZone();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const from = new Date(Date.UTC(y, m - 7, 1));
  const to = new Date(Date.UTC(y, m - 1, 1)); // this month is partial: left out

  const monthStart = `${today.slice(0, 8)}01`;
  const paceFrom = monthsBefore(today, PACE_MONTHS);
  const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);

  const [banks, txns, entries, members] = await Promise.all([
    prisma.paymentInstrument.findMany({ where: { householdId: user.householdId, archived: false, type: "BANK_ACCOUNT" } }),
    prisma.transaction.findMany({
      where: { householdId: user.householdId, date: { gte: from, lt: to } },
      select: { amount: true, currency: true, date: true, category: { select: { name: true, direction: true, kind: true } } },
    }),
    prisma.emergencyFundEntry.findMany({
      where: { householdId: user.householdId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { id: true, date: true, amountUsd: true, note: true, byUser: { select: { name: true } } },
    }),
    prisma.user.findMany({ where: { householdId: user.householdId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  ]);

  let fromAccounts = 0;
  let checkingUsd = 0;
  let inrAbroad = 0;
  const fundAccounts: string[] = [];
  // For an "Emergency..." account: what it gained this month and over the
  // pace window (from the balance just before each), and its recent activity.
  let accountAddedThisMonth = 0;
  let accountAddedForPace = 0;
  let accountPaceFrom = today;
  const accountActivity: { id: string; date: string; amountUsd: number; label: string; note: string | null; by: string | null }[] = [];
  for (const b of banks) {
    if (b.openingBalance === null || !b.openingBalanceDate) continue;
    const opening = Number(b.openingBalance);
    const bal = await computeInstrumentBalance(b.id, opening, b.openingBalanceDate);
    if (b.currency === "USD" && EMERGENCY_ACCOUNT.test(b.name)) {
      fromAccounts += bal;
      fundAccounts.push(b.name);
      const before = (d: string) => computeInstrumentBalance(b.id, opening, b.openingBalanceDate!, new Date(dayStart(d).getTime() - 1));
      const opened = b.openingBalanceDate.toISOString().slice(0, 10);
      const since = opened > paceFrom ? opened : paceFrom;
      accountAddedThisMonth += bal - (await before(opened > monthStart ? opened : monthStart));
      accountAddedForPace += bal - (await before(since));
      if (since < accountPaceFrom) accountPaceFrom = since;
      const items = await balanceItems(b.id, dayStart(monthsBefore(today, 6)));
      for (const it of items) {
        accountActivity.push({ id: it.id, date: it.date, amountUsd: it.amount, label: fundAccounts.length > 1 ? `${b.name}: ${it.label}` : it.label, note: it.notes, by: null });
      }
    } else if (b.currency === "USD") checkingUsd += bal;
    else if (b.currency === "INR") inrAbroad += bal; // money in India isn't at hand for US bills
  }

  // The typed-in fund: the starting amount plus everything added since.
  const entryTotal = entries.reduce((s, e) => s + Number(e.amountUsd), 0);
  const startingUsd = household?.emergencyFundUsd != null ? Number(household.emergencyFundUsd) : null;
  const entered = startingUsd != null || entries.length ? (startingUsd ?? 0) + entryTotal : null;
  const source = fundAccounts.length ? "account" : entered != null ? "entered" : "none";
  const cashUsd = source === "account" ? fromAccounts : (entered ?? 0);

  const months = new Map<string, { essentials: number; total: number }>();
  for (let i = 6; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.set(d.toISOString().slice(0, 7), { essentials: 0, total: 0 });
  }
  for (const t of txns) {
    const b = months.get(t.date.toISOString().slice(0, 7));
    if (!b) continue;
    const kind = kindOf(t.category);
    if (!countsAsSpending(kind)) continue;
    const spend = flowOf(kind, toApproxUsd(Number(t.amount), t.currency)).spending;
    b.total += spend;
    if (isEssential(kind, t.category.name)) b.essentials += spend;
  }
  // Months before the household's records began would drag the average down.
  const used = [...months.values()].filter((x) => x.total > 0);

  const fund = emergencyFund({ cashUsd, months: used, targetMonths: target });

  // Added this month and the pace, from the entries or the account.
  const day = (d: Date) => d.toISOString().slice(0, 10);
  let addedThisMonth = accountAddedThisMonth;
  let added = accountAddedForPace;
  let since = accountPaceFrom;
  if (source !== "account") {
    addedThisMonth = entries.filter((e) => day(e.date) >= monthStart).reduce((s, e) => s + Number(e.amountUsd), 0);
    added = entries.filter((e) => day(e.date) >= paceFrom).reduce((s, e) => s + Number(e.amountUsd), 0);
    const first = entries.length ? day(entries[entries.length - 1].date) : paceFrom;
    since = first > paceFrom ? first : paceFrom;
  }
  const pace = fundPace({ added, since, today, gap: fund.gap });

  // Who has put in what (net of money taken out), for the typed-in fund.
  const byPerson = new Map<string, number>();
  for (const e of entries) {
    const who = e.byUser?.name ?? "Joint";
    byPerson.set(who, (byPerson.get(who) ?? 0) + Number(e.amountUsd));
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const history =
    source === "account"
      ? accountActivity.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8)
      : entries.slice(0, 8).map((e) => ({ id: e.id, date: day(e.date), amountUsd: Number(e.amountUsd), label: Number(e.amountUsd) >= 0 ? "Added" : "Taken out", note: e.note, by: e.byUser?.name ?? "Joint" }));

  return NextResponse.json({
    targetMonths: target,
    source,
    cashUsd: Math.round(cashUsd * 100) / 100,
    fundAccounts,
    checkingUsd: Math.round(checkingUsd * 100) / 100,
    inrInIndia: Math.round(inrAbroad * 100) / 100,
    monthsAveraged: used.length,
    ...fund,
    startingUsd: startingUsd ?? 0,
    addedThisMonth: r2(addedThisMonth),
    ...pace,
    history,
    entryCount: source === "account" ? accountActivity.length : entries.length,
    byPerson: [...byPerson.entries()].map(([name, net]) => ({ name, net: r2(net) })).sort((a, b) => b.net - a.net),
    members,
    me: user.id,
    today,
  });
}

// The typed-in amount set aside, and the target in months. The amount is
// the fund's total now: what's stored is that less the entries, so the
// money added since stays in the history.
const schema = z.object({
  fundUsd: z.number().min(0).max(10_000_000).nullable().optional(),
  targetMonths: z.number().int().min(1).max(24).optional(),
});

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the amount." }, { status: 400 });
  const { fundUsd, targetMonths } = parsed.data;
  let startingUsd: number | null | undefined = fundUsd;
  if (fundUsd != null) {
    const sum = await prisma.emergencyFundEntry.aggregate({ where: { householdId: user.householdId }, _sum: { amountUsd: true } });
    startingUsd = Math.round((fundUsd - Number(sum._sum.amountUsd ?? 0)) * 100) / 100;
  }
  await prisma.household.update({
    where: { id: user.householdId },
    data: {
      ...(startingUsd !== undefined ? { emergencyFundUsd: startingUsd } : {}),
      ...(targetMonths !== undefined ? { emergencyTargetMonths: targetMonths } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
