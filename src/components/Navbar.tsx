"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

// Kept to the pages used day-to-day. Everything else lives under "More" --
// at 12 total links the row was overflowing and wrapping onto two lines,
// which threw off the active-link underline alignment.
const primaryLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/debts", label: "Debts" },
  { href: "/recurring", label: "Recurring" },
  { href: "/goals", label: "Goals" },
  { href: "/net-worth", label: "Net Worth" },
];

const moreLinks = [
  { href: "/instruments", label: "Instruments" },
  { href: "/categories", label: "Categories" },
  { href: "/import", label: "Import" },
  { href: "/household", label: "Household" },
  { href: "/settings", label: "Settings" },
];

const allLinks = [...primaryLinks, ...moreLinks];

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

export default function Navbar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const moreActive = moreLinks.some((link) => pathname?.startsWith(link.href));

  // Close the "More" dropdown on an outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <nav className="bg-ink-900">
      <div className="mx-auto flex max-w-6xl items-center px-4 py-3">
        <span className="font-display mr-8 whitespace-nowrap text-lg italic text-brand-300">Family Finance</span>

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

        <button onClick={() => signOut({ callbackUrl: "/login" })} className="ml-auto whitespace-nowrap text-sm text-ink-300 hover:text-white">
          Sign out
        </button>
      </div>

      {/* Mobile links -- full flat list, horizontally scrollable */}
      <div className="flex gap-4 overflow-x-auto px-4 py-2 sm:hidden">
        {allLinks.map((link) => {
          const active = pathname?.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`whitespace-nowrap text-sm ${active ? "font-medium text-brand-300" : "text-ink-300"}`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
