"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/goals", label: "Goals" },
  { href: "/net-worth", label: "Net Worth" },
  { href: "/debts", label: "Debts" },
  { href: "/recurring", label: "Recurring" },
  { href: "/instruments", label: "Instruments" },
  { href: "/categories", label: "Categories" },
  { href: "/import", label: "Import" },
  { href: "/household", label: "Household" },
  { href: "/settings", label: "Settings" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="bg-ink-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-8">
          <span className="font-display text-lg italic text-brand-300">Family Finance</span>
          <div className="hidden gap-5 sm:flex">
            {links.map((link) => {
              const active = pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`border-b-2 py-1 text-sm transition ${
                    active ? "border-brand-400 text-white" : "border-transparent text-ink-300 hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-sm text-ink-300 hover:text-white">
          Sign out
        </button>
      </div>
      {/* Mobile links */}
      <div className="flex gap-4 overflow-x-auto px-4 py-2 sm:hidden">
        {links.map((link) => {
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
