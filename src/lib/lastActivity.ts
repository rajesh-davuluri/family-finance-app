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
  // How it got into the app -- typed in, imported from a statement (CSV or
  // PDF), a forwarded/Gmail alert, the Telegram bot, or a recurring template.
  source: TransactionSource;
};

export type TransactionSource = "MANUAL" | "IMPORTED" | "EMAIL" | "TELEGRAM" | "RECURRING";

export const SOURCE_LABELS: Record<TransactionSource, string> = {
  MANUAL: "added manually",
  IMPORTED: "imported",
  EMAIL: "via email",
  TELEGRAM: "via Telegram",
  RECURRING: "from recurring",
};

// The stored source, or for rows from before it was stored, what it can be
// inferred from (email alerts were saved as "Email: ..." one-row imports).
export function sourceOf(t: {
  source?: string | null;
  recurringTemplateId?: string | null;
  importBatchId?: string | null;
  importBatch?: { fileName: string } | null;
}): TransactionSource {
  if (t.source && t.source in SOURCE_LABELS) return t.source as TransactionSource;
  if (t.recurringTemplateId) return "RECURRING";
  if (t.importBatch?.fileName.startsWith("Email:")) return "EMAIL";
  if (t.importBatchId) return "IMPORTED";
  return "MANUAL";
}

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
