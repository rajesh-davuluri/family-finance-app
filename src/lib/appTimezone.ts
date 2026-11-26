// The household's local time zone, for deciding which calendar day "today"
// is when a transaction arrives without a date (Telegram "450 swiggy", an
// alert email with no date in it). The server runs on UTC, which is already
// tomorrow during a US evening. Override with APP_TIMEZONE (an IANA name such
// as "Asia/Kolkata") if the household moves.
const DEFAULT_TIMEZONE = "America/New_York";

function zone(): string {
  const tz = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    console.error(`Invalid APP_TIMEZONE "${tz}", using ${DEFAULT_TIMEZONE}`);
    return DEFAULT_TIMEZONE;
  }
}

// YYYY-MM-DD of the given instant, as a calendar date in the household's zone.
export function calendarDateInZone(instant: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant
  );
}

// Today in the household's zone, as a Date whose local Y/M/D fields are that
// calendar day -- for code that does day arithmetic with getDate()/setDate().
export function todayInZone(): Date {
  const [y, m, d] = calendarDateInZone().split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Whether people here write 11/03 for November 3 (month first). True for
// time zones in the Americas -- the US default -- false elsewhere (11 March).
export function prefersMonthFirst(): boolean {
  return zone().startsWith("America/");
}
