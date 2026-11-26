// Browser events pages listen for, so a change made from the app shell
// (the ＋ button in the bottom bar) shows up on whatever page is open.
export const TRANSACTIONS_CHANGED = "ff:transactions-changed";

export function announceTransactionsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TRANSACTIONS_CHANGED));
}
