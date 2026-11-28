// Checking an account against the bank: when the app's balance for a date
// isn't what the bank shows, the likely reasons, most telling first. Pure --
// the API gathers the account's items (src/lib/balanceCalculations.ts).
//
// `diff` is the bank's figure minus the app's: positive when the app is
// short (money in is missing, or money out is recorded that shouldn't be).

export type CheckItem = { id: string; kind: "TRANSACTION" | "TRANSFER"; date: string; label: string; notes: string | null; amount: number }; // signed: money in positive

export type Hint = {
  kind: "IN_TRANSIT" | "EXTRA" | "DUPLICATE" | "WRONG_WAY" | "START_DAY" | "MISSING" | "GAP" | "SWAPPED";
  text: string;
  items?: CheckItem[];
  // GAP: the quiet stretch.
  from?: string;
  to?: string;
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

// Entries the app has but the bank or card hadn't posted yet on `asOf`: a
// purchase made a day or two before a statement closed that posts after it,
// or a payment made that the card applies days later. They're recent -- in
// the TRANSIT_DAYS up to `asOf` -- and together exactly the difference. The
// fewest such entries, or null.
export const TRANSIT_DAYS = 5;
const MAX_TRANSIT_ITEMS = 16; // beyond this, only singles and pairs are tried

export function inTransit(input: { diff: number; items: CheckItem[]; asOf: string }): CheckItem[] | null {
  const target = -cents(input.diff);
  if (target === 0) return null;
  const recent = input.items
    .filter((i) => i.date <= input.asOf && days(i.date, input.asOf) < TRANSIT_DAYS)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!recent.length) return null;
  let best: CheckItem[] | null = null;
  const consider = (set: CheckItem[]) => {
    if (set.reduce((n, i) => n + cents(i.amount), 0) === target && (!best || set.length < best.length)) best = set;
  };
  if (recent.length <= MAX_TRANSIT_ITEMS) {
    for (let mask = 1; mask < 1 << recent.length; mask++) {
      const set = recent.filter((_, k) => mask & (1 << k));
      if (best && set.length >= (best as CheckItem[]).length) continue;
      consider(set);
    }
  } else {
    for (let a = 0; a < recent.length; a++) {
      consider([recent[a]]);
      for (let b = a + 1; b < recent.length; b++) consider([recent[a], recent[b]]);
    }
  }
  return best;
}

// "Matches once your $39.18 Crocs Sandals (Nov 25) purchase posts."
export function transitText(items: CheckItem[], money: (n: number) => string, card = false): string {
  const md = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
  const one = (i: CheckItem) => {
    const name = (i.notes?.trim() || i.label).replace(/\s+/g, " ");
    return `${money(Math.abs(i.amount))} ${name.length > 30 ? `${name.slice(0, 29)}…` : name} (${md(i.date)})`;
  };
  const list = items.length <= 2 ? items.map(one).join(" and ") : `${items.slice(0, 2).map(one).join(", ")} and ${items.length - 2} more`;
  return `Matches once ${list} ${items.length === 1 ? "posts" : "post"}${card ? " to the card" : " at the bank"}: made before that date, posted after it.`;
}

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

  // Made just before the date, posted after it: not a mistake at all.
  const transit = inTransit({ diff, items, asOf: input.asOf });
  if (transit) {
    hints.push({
      kind: "IN_TRANSIT",
      text: card
        ? "Made in the last few days before this date and posted by the card after it: nothing is wrong. They'll be on the next statement."
        : "Made in the last few days before this date and cleared by the bank after it: nothing is wrong.",
      items: transit,
    });
  }

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
    hints.push({ kind: "GAP", from: widest.from, to: widest.to, text: `Nothing is recorded between ${nice(widest.from)} and ${nice(widest.to)} (${widest.days} days). A statement that was never imported?` });
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

// One short line on where a difference most likely is, for the warning next
// to the balance. First: did it appear after the check (entries added,
// changed or deleted since), or was it there when the check was made? Then
// the most telling suspect from findCauses, or what kind of entry is missing.
//
// `checkedDiff`: the difference when the check was made (bank minus the
// app's figure then). `addedSince`: entries dated within the check that were
// recorded after it, signed like `items`. `money` formats an amount.
export function explainGap(input: {
  diff: number;
  checkedDiff: number;
  checkedOn: string; // when the check was made, YYYY-MM-DD
  asOf: string;
  since: string;
  items: CheckItem[];
  addedSince: CheckItem[];
  card?: boolean;
  money: (n: number) => string;
}): string | null {
  const { diff, checkedDiff, money } = input;
  const card = !!input.card;
  if (Math.abs(diff) < MATCH_EPS) return null;
  const what = (i: CheckItem) => {
    const name = (i.notes?.trim() || i.label).replace(/\s+/g, " ");
    const short = name.length > 40 ? `${name.slice(0, 39)}…` : name;
    return `"${short}" ${money(Math.abs(i.amount))} on ${i.date.slice(0, 4) === input.asOf.slice(0, 4) ? nice(i.date).replace(/, \d{4}$/, "") : nice(i.date)}`;
  };

  // The difference moved after the check: something dated within it changed.
  const moved = r2(diff - checkedDiff);
  if (Math.abs(moved) >= MATCH_EPS) {
    const checked = nice(input.checkedOn).replace(/, \d{4}$/, "");
    const added = [...input.addedSince].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    // Adding an entry worth `a` lowers the difference by `a`.
    const explained = added.length && cents(added.reduce((s, i) => s + i.amount, 0)) === -cents(moved);
    if (added.length) {
      const list = added.slice(0, 2).map(what).join(", ") + (added.length > 2 ? ` and ${added.length - 2} more` : "");
      return `Added after your check on ${checked}: ${list}${explained ? "" : ". Something else was also changed or deleted"}`;
    }
    return `It matched when you checked on ${checked}: an entry dated on or before ${nice(input.asOf).replace(/, \d{4}$/, "")} was changed or deleted since`;
  }

  const hints = findCauses({ diff, items: input.items, since: input.since, asOf: input.asOf, card });
  const top = hints.find((h) => h.kind !== "MISSING" && h.kind !== "GAP");
  const quiet = hints.find((h) => h.kind === "GAP");
  // The year only when it isn't the check's own year.
  const md = (d: string) => (d.slice(0, 4) === input.asOf.slice(0, 4) ? nice(d).replace(/, \d{4}$/, "") : nice(d));
  const one = top?.items?.[0];
  const more = (top?.items?.length ?? 0) > 1 ? ` (or ${top!.items!.length - 1} more like it)` : "";
  const here = card ? "card" : "account";
  if (top?.kind === "DUPLICATE" && one) {
    const twin = input.items.find((o) => o.id !== one.id && cents(o.amount) === cents(one.amount) && Math.abs(days(one.date, o.date)) <= TWIN_DAYS);
    return `Likely recorded twice: ${what(one)}${twin ? ` and again on ${md(twin.date)}` : ""}`;
  }
  if (top?.kind === "EXTRA" && one) return `Likely ${what(one)}${more}: it's exactly the difference. Is it really on this ${here}?`;
  if (top?.kind === "WRONG_WAY" && one) return `Likely ${what(one)}${more} recorded the wrong way round`;
  if (top?.kind === "START_DAY") return "Likely the entries on the starting-balance day, counted twice";
  if (top?.kind === "SWAPPED") return "Likely two digits swapped in an amount (54.00 typed as 45.00)";
  const abs = money(Math.abs(diff));
  // Nothing in the records explains it, so something is missing from them;
  // a quiet stretch is the first place to look.
  const where = quiet?.from && quiet.to ? `, perhaps between ${md(quiet.from)} and ${md(quiet.to)} when nothing is recorded (a statement not imported?)` : "";
  if (card) return diff > 0 ? `Likely ${abs} of charges on the card not recorded here (a purchase, interest or a fee)${where}` : `Likely ${abs} of payments or refunds on the card not recorded here${where}`;
  return diff > 0 ? `Likely ${abs} of money in not recorded here (a deposit, refund, interest or transfer in)${where}` : `Likely ${abs} of money out not recorded here (a payment, fee or transfer out)${where}`;
}
