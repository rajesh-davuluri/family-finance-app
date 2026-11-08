"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import NotificationBell from "@/components/NotificationBell";
import AddTransactionModal from "@/components/AddTransactionModal";
import { announceTransactionsChanged } from "@/lib/events";

// Kept to the pages used day-to-day. Everything else lives under "More" --
// at 12 total links the row was overflowing and wrapping onto two lines,
// which threw off the active-link underline alignment.
const primaryLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/paychecks", label: "Paychecks" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/debts", label: "Debts" },
  { href: "/recurring", label: "Recurring" },
  { href: "/goals", label: "Goals" },
  { href: "/net-worth", label: "Net Worth" },
];

const moreLinks = [
  { href: "/cards", label: "Credit cards" },
  { href: "/reports", label: "Reports" },
  { href: "/investments", label: "Investments" },
  { href: "/policies", label: "Policies" },
  { href: "/instruments", label: "Instruments" },
  { href: "/categories", label: "Categories" },
  { href: "/import", label: "Import" },
  { href: "/household", label: "Household" },
  { href: "/settings", label: "Settings" },
];

// The phone's "More" sheet: every page not in the bottom bar, grouped the
// way money gets looked at -- this month, what you own, the records behind it.
const sheetGroups: { title: string; links: { href: string; label: string; hint: string }[] }[] = [
  {
    title: "Money this month",
    links: [
      { href: "/cards", label: "Credit cards", hint: "Statements, due dates, owed now" },
      { href: "/budgets", label: "Budgets", hint: "Limits by category" },
      { href: "/recurring", label: "Recurring bills", hint: "Rent, EMIs, subscriptions" },
      { href: "/debts", label: "Debts", hint: "Loans and what's left" },
      { href: "/goals", label: "Goals", hint: "Saving toward something" },
    ],
  },
  {
    title: "Wealth",
    links: [
      { href: "/investments", label: "Investments", hint: "Stocks, funds, 401(k)" },
      { href: "/net-worth", label: "Net worth", hint: "Own minus owe" },
      { href: "/policies", label: "Policies", hint: "LIC, term, premiums" },
    ],
  },
  {
    title: "Records",
    links: [
      { href: "/reports", label: "Reports", hint: "Any period, CSV, PDF" },
      { href: "/import", label: "Import", hint: "Bank and card statements" },
      { href: "/instruments", label: "Accounts & cards", hint: "Balances, details, transfers" },
      { href: "/categories", label: "Categories", hint: "Types and groups" },
    ],
  },
  {
    title: "Household",
    links: [
      { href: "/household", label: "Household", hint: "Members and invites" },
      { href: "/settings", label: "Settings", hint: "Security, Telegram" },
    ],
  },
];

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`whitespace-nowrap border-b-2 py-1 text-sm transition ${
        active ? "border-brand-400 text-white" : "border-transparent text-ink-300 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

// Outline icons for the bottom bar (24px, 1.75 stroke).
function Icon({ name }: { name: "home" | "list" | "plus" | "pay" | "more" }) {
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="3.5" cy="6" r="1" />
          <circle cx="3.5" cy="12" r="1" />
          <circle cx="3.5" cy="18" r="1" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common} strokeWidth={2.25}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "pay":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
          <path d="M12 13.5v4M10.5 15h3" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </svg>
      );
  }
}

export default function Navbar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const moreActive = moreLinks.some((link) => pathname?.startsWith(link.href));
  const tabActive = (href: string) => !!pathname?.startsWith(href);
  const sheetActive = !["/dashboard", "/transactions", "/paychecks"].some(tabActive);

  // Close the "More" dropdown on an outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close the phone sheet when the page changes; don't scroll behind it.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = sheetOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheetOpen]);

  return (
    <>
      <nav className="sticky top-0 z-30 bg-ink-900 pt-[env(safe-area-inset-top)] print:hidden sm:static">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-3">
          {/* Clicking the name reloads the current page (fresh data everywhere on it). */}
          <a
            href={pathname ?? "/dashboard"}
            onClick={(e) => {
              e.preventDefault();
              window.location.reload();
            }}
            title="Refresh this page"
            className="font-display mr-8 whitespace-nowrap text-lg italic text-brand-300 hover:text-brand-100"
          >
            Family Finance
          </a>

          <div className="hidden flex-1 items-center gap-5 sm:flex">
            {primaryLinks.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} active={!!pathname?.startsWith(link.href)} />
            ))}

            <div ref={moreRef} className="relative">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className={`whitespace-nowrap border-b-2 py-1 text-sm transition ${
                  moreActive ? "border-brand-400 text-white" : "border-transparent text-ink-300 hover:text-white"
                }`}
              >
                More ▾
              </button>
              {moreOpen && (
                <div className="absolute left-0 top-full z-10 mt-2 w-44 rounded-md border border-ink-600 bg-ink-800 py-1 shadow-lg">
                  {moreLinks.map((link) => {
                    const active = pathname?.startsWith(link.href);
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setMoreOpen(false)}
                        className={`block px-4 py-2 text-sm ${active ? "text-brand-300" : "text-ink-300 hover:bg-ink-900 hover:text-white"}`}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <NotificationBell />
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="hidden whitespace-nowrap text-sm text-ink-300 hover:text-white sm:block"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Phone: bottom tab bar, within thumb reach, clear of the home indicator. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-800 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur print:hidden sm:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
          <TabLink href="/dashboard" label="Home" icon="home" active={tabActive("/dashboard")} />
          <TabLink href="/transactions" label="Activity" icon="list" active={tabActive("/transactions")} />
          <div className="flex justify-center">
            <button
              onClick={() => setAdding(true)}
              aria-label="Add a transaction"
              className="-mt-6 mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg ring-4 ring-ink-900 active:scale-95"
            >
              <Icon name="plus" />
            </button>
          </div>
          <TabLink href="/paychecks" label="Paychecks" icon="pay" active={tabActive("/paychecks")} />
          <button
            onClick={() => setSheetOpen(true)}
            aria-expanded={sheetOpen}
            className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[11px] ${sheetActive ? "text-brand-300" : "text-ink-300"}`}
          >
            <Icon name="more" />
            More
          </button>
        </div>
      </nav>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-paper sm:hidden" role="dialog" aria-modal="true" aria-label="All pages">
          <div className="flex items-center justify-between bg-ink-900 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
            <span className="font-display text-lg italic text-brand-300">All pages</span>
            <button onClick={() => setSheetOpen(false)} className="flex h-11 w-11 items-center justify-center text-2xl text-ink-300" aria-label="Close">
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">
            {sheetGroups.map((g) => (
              <section key={g.title} className="mb-5">
                <h2 className="mb-1.5 px-1 font-sans text-xs font-semibold uppercase tracking-wide text-gray-500">{g.title}</h2>
                <ul className="divide-y overflow-hidden rounded-xl border bg-white">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} onClick={() => setSheetOpen(false)} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-gray-50">
                        <span>
                          <span className={`block text-[15px] ${tabActive(l.href) ? "font-semibold text-brand-700" : "text-ink-900"}`}>{l.label}</span>
                          <span className="block text-xs text-gray-500">{l.hint}</span>
                        </span>
                        <span className="text-gray-300" aria-hidden>
                          ›
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full rounded-xl border bg-white px-4 py-3 text-left text-[15px] text-expense-600 active:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      <AddTransactionModal
        open={adding}
        onClose={() => setAdding(false)}
        onSuccess={() => {
          setAdding(false);
          announceTransactionsChanged();
        }}
      />
    </>
  );
}

function TabLink({ href, label, icon, active }: { href: string; label: string; icon: "home" | "list" | "pay"; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[11px] ${active ? "text-brand-300" : "text-ink-300"}`}
    >
      <Icon name={icon} />
      {label}
    </Link>
  );
}
