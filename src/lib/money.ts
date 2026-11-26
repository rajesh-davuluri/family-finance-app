// One way to show money everywhere: thousands separators (Indian grouping
// for rupees), the currency's symbol, and a real minus sign in front:
// $4,293.64, −$1,489.04, ₹1,27,569.00.

const SYMBOLS: Record<string, string> = { USD: "$", INR: "₹", EUR: "€", GBP: "£" };

export function money(n: number, currency = "USD", digits = 2): string {
  const v = Number.isFinite(n) ? n : 0;
  const s = Math.abs(v).toLocaleString(currency === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sym = SYMBOLS[currency] ?? `${currency} `;
  return `${v < 0 && Math.abs(v) >= 0.5 * 10 ** -digits ? "−" : ""}${sym}${s}`;
}
