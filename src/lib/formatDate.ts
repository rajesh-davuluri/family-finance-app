// Transaction/payment/transfer dates are calendar dates with no meaningful
// time-of-day component, but they're stored as UTC timestamps -- an
// <input type="date"> value of "2026-09-15" becomes 2026-09-15T00:00:00Z
// when saved. Formatting that with `new Date(iso).toLocaleDateString()`
// lets the browser's LOCAL timezone shift the display back a day for
// anyone west of UTC (e.g. US Eastern), since midnight UTC is still the
// evening before in local time.
//
// This extracts the Y-M-D directly from the stored string and builds a
// LOCAL Date from those exact numbers instead of parsing the UTC instant,
// so the displayed date always matches what was actually selected/stored,
// regardless of the viewer's timezone.
export function formatDate(dateString: string, options?: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = dateString.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, options);
}

// Same underlying issue in reverse: `new Date().toISOString().slice(0, 10)`
// converts "right now" to UTC first, which rolls over to tomorrow's date
// in the evening for anyone west of UTC (e.g. after 8pm Eastern). This
// builds the YYYY-MM-DD string from the LOCAL date instead, for defaulting
// a date input to "today."
export function getTodayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
