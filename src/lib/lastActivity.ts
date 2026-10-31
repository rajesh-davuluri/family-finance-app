// Shape of GET /api/transactions/last-activity, shared by the Dashboard
// summary line and the Import page's per-account list.
export type ActivityTransaction = {
  createdAt: string;
  date: string;
  amount: number;
  currency: string;
  notes: string | null;
  categoryName: string;
  direction: "INCOME" | "EXPENSE";
  instrumentName: string;
  createdByName: string;
  // How it got into the app -- typed in, imported from a statement, or
  // generated from a recurring template.
  source: "MANUAL" | "IMPORTED" | "RECURRING";
};

export const SOURCE_LABELS: Record<ActivityTransaction["source"], string> = {
  MANUAL: "added manually",
  IMPORTED: "imported",
  RECURRING: "from recurring",
};

export type LastActivity = {
  lastAdded: ActivityTransaction | null;
  instruments: {
    id: string;
    name: string;
    type: string;
    last4: string | null;
    transactionCount: number;
    latestTransactionDate: string | null;
    lastAddedAt: string | null;
    // Latest by transaction date (ties broken by most recently added).
    latestTransaction: ActivityTransaction | null;
  }[];
};

// Past this many days without anything new, nudge toward importing the
// latest statements -- roughly one card billing cycle.
export const STALE_AFTER_DAYS = 30;

export function daysSince(iso: string): number {
  // Clamped at 0 so a future-dated transaction doesn't read "-3 days ago".
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
