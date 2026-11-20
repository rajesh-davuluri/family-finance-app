// Checking an account against the bank: when the app's balance for a date
// isn't what the bank shows, the likely reasons, most telling first. Pure --
// the API gathers the account's items (src/lib/balanceCalculations.ts).
//
// `diff` is the bank's figure minus the app's: positive when the app is
// short (money in is missing, or money out is recorded that shouldn't be).

export type CheckItem = { id: string; kind: "TRANSACTION" | "TRANSFER"; date: string; label: string; notes: string | null; amount: number }; // signed: money in positive

export type Hint = {
  kind: "EXTRA" | "DUPLICATE" | "WRONG_WAY" | "START_DAY" | "MISSING" | "GAP" | "SWAPPED";
  text: string;
  items?: CheckItem[];
};

export const MATCH_EPS = 0.005;
// Two entries of the same amount this close together may be one purchase.
const TWIN_DAYS = 4;
// A quiet stretch worth a mention: at least this long, and well beyond the
// account's usual gap between entries.
const GAP_MIN_DAYS = 10;

const DAY = 86_400_000;
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const days = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);
const cents = (n: number) => Math.round(n * 100);
const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
export const isMatch = (bank: number, app: number) => Math.abs(bank - app) < MATCH_EPS;

// For a credit card (`card: true`) the figures are what's owed: `diff` is
// the card's figure minus the app's, and each item is signed by what it does
// to the amount owed (a charge positive, a payment or refund negative). The
// arithmetic is the same; only the wording changes.
export function findCauses(input: { diff: number; items: CheckItem[]; since: string; asOf: string; card?: boolean }): Hint[] {
  const card = !!input.card;
  const diff = r2(input.diff);
  if (Math.abs(diff) < MATCH_EPS) return [];
  const items = input.items.filter((i) => i.date >= input.since && i.date <= input.asOf).sort((a, b) => a.date.localeCompare(b.date));
  const hints: Hint[] = [];
  const abs = Math.abs(diff);

  // An entry that, taken out, closes the gap exactly. With a twin nearby
  // (same amount, days apart) it's probably recorded twice.
  const extra = items.filter((i) => cents(i.amount) === -cents(diff));
  const twins = extra.filter((i) => items.some((o) => o.id !== i.id && cents(o.amount) === cents(i.amount) && Math.abs(days(i.date, o.date)) <= TWIN_DAYS));
  if (twins.length) {
    hints.push({ kind: "DUPLICATE", text: "Recorded twice? These match the difference exactly, and each has a twin of the same amount a few days away. Delete one of the pair.", items: twins.slice(0, 6) });
  } else if (extra.length) {
    hints.push({
      kind: "EXTRA",
      text: card ? "The difference is exactly this entry. Is it really on this card, and has it posted there?" : "The difference is exactly this entry. Is it really on this account, and did it go through at the bank?",
      items: extra.slice(0, 6),
    });
  }

  // An entry recorded the wrong way round moves the balance by twice itself.
  if (cents(diff) % 2 === 0) {
    const flipped = items.filter((i) => cents(i.amount) * 2 === -cents(diff));
    if (flipped.length)
      hints.push({
        kind: "WRONG_WAY",
        text: card ? "Half the difference: one of these may be recorded the wrong way round (a refund as a charge, or the reverse)." : "Half the difference: one of these may be recorded the wrong way round (money in as money out, or the reverse).",
        items: flipped.slice(0, 6),
      });
  }

  // Entries dated on the starting-balance day count on top of it; if the
  // starting balance was that day's closing figure, they're counted twice.
  const startDay = card ? [] : items.filter((i) => i.date === input.since);
  if (startDay.length && cents(startDay.reduce((s, i) => s + i.amount, 0)) === -cents(diff)) {
    hints.push({ kind: "START_DAY", text: "The entries dated on the starting-balance day add up to the difference. If the starting balance was that day's closing figure, it already includes them: move the starting date on a day.", items: startDay.slice(0, 6) });
  }

  // A long stretch with nothing recorded: a statement never imported?
  const points = [input.since, ...items.map((i) => i.date), input.asOf];
  const gaps = points.slice(1).map((d, k) => ({ from: points[k], to: d, days: days(points[k], d) }));
  const usual = [...gaps].map((g) => g.days).sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
  const widest = gaps.reduce((m, g) => (g.days > m.days ? g : m), gaps[0]);
  if (widest && widest.days >= GAP_MIN_DAYS && widest.days >= usual * 3) {
    hints.push({ kind: "GAP", text: `Nothing is recorded between ${nice(widest.from)} and ${nice(widest.to)} (${widest.days} days). A statement that was never imported?` });
  }

  // Two digits swapped ($54 typed as $45) always leaves a multiple of 9.
  if (!hints.some((h) => h.kind === "DUPLICATE" || h.kind === "EXTRA") && cents(diff) % 9 === 0 && abs < 1000) {
    hints.push({ kind: "SWAPPED", text: "The difference divides by 9, which is what two swapped digits leave behind (54.00 typed as 45.00). Check recent amounts against the bank's list." });
  }

  // Always: what would have to be missing.
  const lead = hints.length ? "Otherwise, look" : "Look";
  hints.push({
    kind: "MISSING",
    text: card
      ? diff > 0
        ? `${lead} at the card's list for ${abs.toFixed(2)} of charges that aren't here (a purchase not imported, interest or a fee).`
        : `${lead} at the card's list for ${abs.toFixed(2)} of payments or refunds that aren't here. Or the app has charges the card hasn't posted yet: its current balance may leave out pending charges.`
      : diff > 0
        ? `${lead} at the bank's list for ${abs.toFixed(2)} of money in that isn't here (a deposit, refund, interest or transfer in).`
        : `${lead} at the bank's list for ${abs.toFixed(2)} of money out that isn't here (a payment, fee or transfer out).`,
  });
  return hints;
}

// How a gap reads everywhere it's shown: "$50.00 less than your bank" or
// "$50.00 more owed than your card". `diff` is the bank's (or card's) figure
// less the app's, as stored on a check; `amount` is it already formatted.
export function gapWords(diff: number, amount: string, card = false): string {
  return `${amount} ${diff > 0 ? "less" : "more"}${card ? " owed" : ""} than your ${card ? "card" : "bank"}`;
}
