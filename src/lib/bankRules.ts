// Recognises the standard lines on a bank statement (built from Bank of
// America's, which other US banks mostly share) so an import gets them right
// without picking a category for each:
//
//   CITI CARD ONLINE DES:PAYMENT ...          -> card payment (transfer to Citi)
//   DISCOVER DES:E-PAYMENT ...                -> card payment (Discover)
//   Robinhood Card DES:... PPD                -> card payment (Robinhood Card)
//   Mobile Banking payment to CRD 5751        -> card payment (card ending 5751)
//   BN ASSOCIATES IN DES:PAYROLL ...          -> salary
//   Zelle payment from <your own name>        -> transfer between your accounts
//   CYBRID-CROBO.MON / REMITLY / WISE ...     -> money sent to India (remittance)
//   COINBASE / FIDELITY / ...                 -> investing
//   BKOFAMERICA ATM ... WITHDRWL              -> cash withdrawal
//   PAYPAL DES:TRANSFER ID:ADD TO BALANCE     -> transfer to PayPal
//
// Pure: the caller maps a rule to the household's own accounts and
// categories (src/app/(app)/import/page.tsx).

export type BankRule =
  | { kind: "CARD_PAYMENT"; card: { name: RegExp | null; last4: string | null }; label: string }
  | { kind: "SALARY"; label: string }
  | { kind: "OWN_TRANSFER"; label: string }
  | { kind: "INVESTMENT"; label: string }
  | { kind: "REMITTANCE"; label: string }
  | { kind: "CASH_WITHDRAWAL"; label: string }
  | { kind: "PAYPAL_TOPUP"; label: string }
  | { kind: "UTILITY"; label: string }
  | { kind: "RENT"; label: string };

// Card issuers as they appear on a bank statement, and how to find that card
// among the household's accounts by name.
const CARD_PAYEES: { line: RegExp; card: RegExp; label: string }[] = [
  { line: /\bCITI\s*CARD\b|\bCITIBANK\b.*\bPAYMENT\b|\bCITI\b.*\bAUTOPAY\b/i, card: /citi/i, label: "Citi" },
  { line: /\bDISCOVER\b.*\b(E-?PAYMENT|PAYMENT|PMT)\b/i, card: /discover/i, label: "Discover" },
  { line: /\bROBINHOOD\s*CARD\b/i, card: /robinhood/i, label: "Robinhood" },
  { line: /\b(AMEX|AMERICAN\s*EXPRESS)\b.*\b(EPAYMENT|PAYMENT|PMT)\b/i, card: /amex|american express/i, label: "Amex" },
  { line: /\bCAPITAL\s*ONE\b.*\b(PAYMENT|PMT|MOBILE)\b/i, card: /capital one/i, label: "Capital One" },
  { line: /\bCHASE\s*CREDIT\s*CRD\b|\bCHASE\b.*\bAUTOPAY\b|\bCHASE\s*CARD\b.*\bPAYMENT\b/i, card: /chase/i, label: "Chase card" },
  { line: /\bSYNCB\b|\bSYNCHRONY\b|\bOLD\s*NAVY\b.*\bPAYMENT\b/i, card: /old navy|synchrony|gap/i, label: "Synchrony card" },
  { line: /\bAPPLECARD\b|\bAPPLE\s*CARD\b.*\bPAYMENT\b/i, card: /apple/i, label: "Apple Card" },
  { line: /\bBA\s*ELECTRONIC\s*PAYMENT\b|\bBANK\s*OF\s*AMERICA\b.*\bCREDIT\s*CARD\b/i, card: /bofa|bank of america|boa/i, label: "BofA card" },
];

// Money-transfer services sending dollars to an Indian bank account (Crobo
// runs on Cybrid). Not spending and not investing: the money moves to your
// own account abroad.
const REMITTANCE = /\bCYBRID\b|\bCROBO\b|\bREMITLY\b|\bTRANSFERWISE\b|\bWISE\s*(US|INC|PAYMENTS)\b|\bXOOM\b|\bWESTERN\s*UNION\b|\bREMIT2INDIA\b/i;

const INVESTMENT = /\bCOINBASE\b|\bROBINHOOD\s*(SECURITIES|MONEY|CRYPTO|DES:\s*DEBITS)\b|\bFIDELITY\b|\bVANGUARD\b|\bSCHWAB\b|\bE\*?TRADE\b|\bACORNS\b|\bBETTERMENT\b|\bWEALTHFRONT\b|\bM1\s*FINANCE\b/i;

// Utility and phone billers that pay by bank transfer.
const UTILITY = /\bDOMINION\s*ENERGY\b|\bCOMCAST\b|\bXFINITY\b|\bVERIZON\b|\bCITY\s*OF\s*RICHMOND\b|\bCITYOFRICHMOND\b|\bAT&T\b|\bT-?MOBILE\b|\bDUKE\s*ENERGY\b|\bPEPCO\b|\bWASHINGTON\s*GAS\b|\bSPECTRUM\b|\bCOX\s*COMM|\bWATER\s*(DEPT|UTILIT|BILL)/i;

export function classifyBankLine(description: string, opts: { moneyIn: boolean; ownNames: string[] }): BankRule | null {
  const d = description.replace(/\s+/g, " ").trim();
  if (!d) return null;

  if (!opts.moneyIn) {
    // "Mobile Banking payment to CRD 5751": BofA paying one of its own cards.
    const crd = d.match(/\bpayment to CRD (\d{4})\b/i);
    if (crd) return { kind: "CARD_PAYMENT", card: { name: /bofa|bank of america|boa/i, last4: crd[1] }, label: `Card payment (card ending ${crd[1]})` };
    for (const p of CARD_PAYEES) {
      if (p.line.test(d)) return { kind: "CARD_PAYMENT", card: { name: p.card, last4: null }, label: `${p.label} card payment` };
    }
    if (/\bPAYPAL\b.*\b(ADD TO BALANCE|TRANSFER)\b/i.test(d)) return { kind: "PAYPAL_TOPUP", label: "Money moved to PayPal" };
    if (/\bATM\b.*\b(WITHDRWL|WITHDRAWAL|W\/D)\b|\bCASH WITHDRAWAL\b/i.test(d)) return { kind: "CASH_WITHDRAWAL", label: "ATM cash" };
    if (REMITTANCE.test(d)) return { kind: "REMITTANCE", label: "Money sent to India" };
    if (INVESTMENT.test(d)) return { kind: "INVESTMENT", label: "Investing" };
    if (UTILITY.test(d)) return { kind: "UTILITY", label: "Utility bill" };
    if (/\bDES:\s*RENT\b|\bRENT\s*PAYMENT\b/i.test(d)) return { kind: "RENT", label: "Rent" };
  } else if (/\bPAYROLL\b|\bDIRECT DEP(OSIT)?\b|\bDES:\s*(SALARY|PAYROLL)\b/i.test(d)) {
    return { kind: "SALARY", label: "Paycheck" };
  }

  // Zelle / online transfers to or from yourself, in either direction.
  const own = opts.ownNames.map((n) => n.trim().toUpperCase()).filter((n) => n.length >= 3);
  const zelle = d.match(/\bZelle payment (?:from|to) ([A-Z][A-Z .'-]+?)(?:\s+for\b|\s+Conf#|;|$)/i);
  if (zelle && own.some((n) => sameName(zelle[1], n))) return { kind: "OWN_TRANSFER", label: "Between your own accounts" };
  if (/\bOnline Banking transfer (to|from) (CHK|SAV)\b|\bTRANSFER (TO|FROM) (CHECKING|SAVINGS)\b/i.test(d)) {
    return { kind: "OWN_TRANSFER", label: "Between your own accounts" };
  }
  return null;
}

// "RAJESH DAVULURI" vs "Rajesh Davuluri" (or "DAVULURI RAJESH").
function sameName(a: string, b: string) {
  const words = (s: string) => s.toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 2).sort().join(" ");
  return words(a) === words(b);
}

// Bank CSVs list money out as negative and money in as positive; card CSVs
// usually the reverse (purchases positive, payments negative). Whichever
// sign most rows have is taken as money out.
export function moneyInSign(amounts: number[]): 1 | -1 {
  const neg = amounts.filter((a) => a < 0).length;
  const pos = amounts.filter((a) => a > 0).length;
  return neg > pos ? 1 : -1;
}

// Bank CSV downloads often start with a few summary lines before the real
// header ("Description,,Summary Amt." ... then "Date,Description,Amount,...").
// Returns the text from the real header row on.
export function stripCsvPreamble(text: string): string {
  const lines = text.split(/\r?\n/);
  const isHeader = (l: string) => {
    const cells = l.toLowerCase().split(",").map((c) => c.replace(/"/g, "").trim());
    return cells.some((c) => c.includes("date")) && cells.some((c) => c.includes("amount") || c === "debit" || c === "credit");
  };
  const at = lines.findIndex(isHeader);
  return at > 0 ? lines.slice(at).join("\n") : text;
}
