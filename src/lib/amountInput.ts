// Amounts typed the ATM way: only digits, and the last two are always the
// cents. Typing 8, 2, 0, 0 shows "82.00"; backspace drops the last digit
// ("82.00" -> "8.20"). Grouped as it grows ("1,234.50"; rupees the Indian
// way, "1,00,000.00"). The value stays text in the form; read it with
// parseAmount.

const MAX_DIGITS = 11; // up to 999,999,999.99

export function formatAmountInput(raw: string, currency = "USD"): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_DIGITS);
  if (!digits) return "";
  const padded = digits.padStart(3, "0");
  const whole = padded.slice(0, -2);
  const cents = padded.slice(-2);
  return `${currency === "INR" ? groupIndian(whole) : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

// A stored amount (82, "82.5") shown in the same form ("82.00", "82.50").
export function amountToInput(n: number | string | null | undefined, currency = "USD"): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  return formatAmountInput(String(Math.round(v * 100)), currency);
}

// 1234567 -> 12,34,567: the last three digits, then pairs.
function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  return `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${whole.slice(-3)}`;
}

// The number in a formatted amount; NaN when there isn't one.
export function parseAmount(s: string): number {
  const n = s.replace(/,/g, "");
  return n === "" ? NaN : Number(n);
}

// Keeps the cursor at the end, where digits go in.
export function caretToEnd(e: { currentTarget: HTMLInputElement }) {
  const el = e.currentTarget;
  requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
}
