// Fees & interest: money lost to card interest, late fees, annual fees,
// foreign transaction fees, overdrafts and the like -- found in the
// transactions from their statement wording, whatever category they're
// filed under, with fees later reversed ("LATE FEE REVERSAL") marked waived.
// Pure: Reports passes its transactions in; the Needs attention route loads
// the recent ones (src/lib/feesData.ts).

export type FeeKind = "INTEREST" | "LATE_FEE" | "ANNUAL_FEE" | "FX_FEE" | "CASH_ADVANCE_FEE" | "OVERDRAFT" | "RETURNED_PAYMENT" | "ATM_FEE" | "SERVICE_FEE";

export const FEE_LABELS: Record<FeeKind, string> = {
  INTEREST: "Interest",
  LATE_FEE: "Late fee",
  ANNUAL_FEE: "Annual fee",
  FX_FEE: "Foreign transaction fee",
  CASH_ADVANCE_FEE: "Cash advance fee",
  OVERDRAFT: "Overdraft / NSF fee",
  RETURNED_PAYMENT: "Returned payment fee",
  ATM_FEE: "ATM fee",
  SERVICE_FEE: "Bank service fee",
};

// What to do about each, in a few words.
export const FEE_ADVICE: Record<FeeKind, string> = {
  INTEREST: "the statement wasn't paid in full. Pay the whole statement balance by the due date to stop it",
  LATE_FEE: "a first late fee is often waived if you call. Pay the balance, then ask",
  ANNUAL_FEE: "ask the card for a retention offer, or a no-fee version of the card",
  FX_FEE: "use a card with no foreign transaction fee for purchases abroad or on foreign sites",
  CASH_ADVANCE_FEE: "a cash advance costs a fee plus interest from the first day. Avoid card cash withdrawals",
  OVERDRAFT: "ask the bank to waive it, and turn on low-balance alerts or overdraft protection",
  RETURNED_PAYMENT: "a payment bounced. Check the account it was paid from had the money",
  ATM_FEE: "use your own bank's ATMs, or get cash back at a store",
  SERVICE_FEE: "ask what waives it (a minimum balance, direct deposit), or move to a no-fee account",
};

// Most specific first.
const PATTERNS: [FeeKind, RegExp][] = [
  ["CASH_ADVANCE_FEE", /CASH\s*(ADVANCE|ADV)\.?\s*FEE/],
  ["LATE_FEE", /LATE\s*(PAYMENT\s*)?(FEE|CHARGE)/],
  ["RETURNED_PAYMENT", /RETURN(ED)?\s*(PAYMENT|PYMT|ITEM|CHECK|CHK)\s*(FEE|CHARGE)/],
  ["OVERDRAFT", /OVERDRAFT|\bOD\s*FEE|\bNSF\b|INSUFFICIENT\s*FUNDS/],
  ["FX_FEE", /FOREIGN\s*(TRANSACTION|TRANS|TXN|EXCHANGE|CURRENCY|CURR)?\.?\s*FEE|INT'?L\.?\s*(TRANSACTION|TXN|TRANS)?\s*FEE|INTERNATIONAL\s*(TRANSACTION\s*)?FEE|CROSS[\s-]*BORDER\s*FEE|\bFX\s*FEE/],
  ["ATM_FEE", /ATM\s*(WITHDRAWAL\s*|WDL\s*)?(FEE|SURCHARGE)|NON[\s-]*\w*\s*ATM\s*FEE/],
  ["ANNUAL_FEE", /ANNUAL\s*(MEMBERSHIP\s*|CARD\s*)?FEE/],
  ["SERVICE_FEE", /(MONTHLY\s*)?(SERVICE|MAINTENANCE|MAINT)\s*(CHARGE|FEE)|WIRE\s*(TRANSFER\s*)?FEE|PAPER\s*STATEMENT\s*FEE|\bBANK\s*FEE/],
  ["INTEREST", /INTEREST\s*CHARGE|FINANCE\s*CHARGE|PURCHASE\s*INTEREST|INTEREST\s*ON\s*(PURCHASES|CASH|BALANCE|BALANCES)|PERIODIC\s*INTEREST|INTEREST\s*CHARGED/],
];
const REVERSAL = /REVERS|REFUND|WAIVE|\bCREDIT\b|\bADJ(USTMENT)?\b|\bREV\b/;

// The kind of fee a description names, if any.
export function feeKindOf(text: string): FeeKind | null {
  const t = text.toUpperCase();
  for (const [kind, re] of PATTERNS) if (re.test(t)) return kind;
  return null;
}

export type FeeInput = {
  id: string;
  date: string; // YYYY-MM-DD
  notes: string | null;
  categoryName: string;
  direction: "INCOME" | "EXPENSE";
  kind?: string; // category kind; transfers and loans are never fees
  instrumentId: string;
  instrumentName: string;
  amount: number;
  currency: string;
  usd: number;
};

export type Fee = FeeInput & { feeKind: FeeKind; waivedBy: { id: string; date: string } | null };

// How long after a fee its reversal can come.
const WAIVER_DAYS = 75;
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const cents = (n: number) => Math.round(n * 100);

// Every fee in the transactions, each paired with its reversal when one came.
export function findFees(txns: FeeInput[]): Fee[] {
  const text = (t: FeeInput) => `${t.notes ?? ""} ${t.categoryName}`;
  const skip = (t: FeeInput) => t.kind === "TRANSFER" || t.kind === "LOAN" || /balance adjustment/i.test(t.categoryName);
  const fees: Fee[] = [];
  const reversals: (FeeInput & { feeKind: FeeKind })[] = [];
  for (const t of txns) {
    if (skip(t)) continue;
    const k = feeKindOf(text(t));
    if (!k) continue;
    if (t.direction === "EXPENSE") fees.push({ ...t, feeKind: k, waivedBy: null });
    else if (REVERSAL.test(text(t).toUpperCase())) reversals.push({ ...t, feeKind: k });
  }
  fees.sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set<string>();
  for (const f of fees) {
    const r = reversals
      .filter((x) => !used.has(x.id) && x.instrumentId === f.instrumentId && x.feeKind === f.feeKind && cents(x.amount) === cents(f.amount) && x.date >= f.date && days(f.date, x.date) <= WAIVER_DAYS)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (r) {
      used.add(r.id);
      f.waivedBy = { id: r.id, date: r.date };
    }
  }
  return fees;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// What fees cost (approx USD), not counting waived ones.
export function feeTotals(fees: Fee[]) {
  const paid = fees.filter((f) => !f.waivedBy);
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const byKind = new Map<string, number>();
  const byAccount = new Map<string, number>();
  for (const f of paid) {
    add(byKind, f.feeKind, f.usd);
    add(byAccount, f.instrumentName, f.usd);
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].map(([key, usd]) => ({ key, usd: r2(usd) })).sort((a, b) => b.usd - a.usd);
  return {
    totalUsd: r2(paid.reduce((n, f) => n + f.usd, 0)),
    count: paid.length,
    waived: fees.filter((f) => f.waivedBy).length,
    waivedUsd: r2(fees.filter((f) => f.waivedBy).reduce((n, f) => n + f.usd, 0)),
    byKind: sorted(byKind).map((x) => ({ ...x, label: FEE_LABELS[x.key as FeeKind] })),
    byAccount: sorted(byAccount),
  };
}

// Cards charged interest in consecutive months up to the latest month with
// interest (at least `min` in a row): { account, months, latest }.
export function interestStreaks(fees: Fee[], min = 2) {
  const months = new Map<string, Set<string>>();
  for (const f of fees) if (f.feeKind === "INTEREST" && !f.waivedBy) months.set(f.instrumentName, (months.get(f.instrumentName) ?? new Set()).add(f.date.slice(0, 7)));
  const prev = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  };
  const out: { account: string; months: number; latest: string }[] = [];
  for (const [account, set] of months) {
    const latest = [...set].sort().pop()!;
    let n = 1;
    for (let m = prev(latest); set.has(m); m = prev(m)) n++;
    if (n >= min) out.push({ account, months: n, latest });
  }
  return out.sort((a, b) => b.months - a.months);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

// "Citi Double Cash charged a $40.00 late fee on Nov 24: a first late fee is ..."
export function feeAlertText(f: Fee, money: (n: number) => string): string {
  const what = f.feeKind === "INTEREST" ? `${money(f.amount)} interest` : `a ${money(f.amount)} ${FEE_LABELS[f.feeKind].toLowerCase()}`;
  return `${f.instrumentName} charged ${what} on ${md(f.date)}: ${FEE_ADVICE[f.feeKind]}`;
}
