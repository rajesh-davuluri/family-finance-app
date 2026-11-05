"use client";

import { ReactNode, useEffect, useId, useState } from "react";

// A section whose body can be collapsed from its header. The open/closed
// choice is remembered per browser (localStorage) under `storageKey`, so a
// section someone closed stays closed next visit. Storage can be missing or
// blocked (private windows, etc.) -- then it just starts in `defaultOpen`.
//
// variant "card": the usual white bordered panel (Dashboard sections).
// variant "plain": no panel around it (sections whose body is its own card).
export default function CollapsibleSection({
  storageKey,
  title,
  summary,
  actions,
  defaultOpen = true,
  variant = "card",
  children,
}: {
  storageKey: string;
  title: ReactNode;
  summary?: ReactNode; // shown next to the title, e.g. a count -- useful while collapsed
  actions?: ReactNode; // right side of the header, e.g. a link or a toggle
  defaultOpen?: boolean;
  variant?: "card" | "plain";
  children: ReactNode;
}) {
  const key = `ff:section:${storageKey}`;
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  // Read after mount so server and first client render agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === "open" || saved === "closed") setOpen(saved === "open");
    } catch {
      // storage unavailable -- keep the default
    }
  }, [key]);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      try {
        window.localStorage.setItem(key, next ? "open" : "closed");
      } catch {
        // storage unavailable -- the choice just isn't remembered
      }
      return next;
    });
  }

  return (
    <section className={variant === "card" ? "rounded-lg border bg-white p-4" : "space-y-2"}>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${open && variant === "card" ? "mb-3" : ""}`}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="-ml-1 flex items-center gap-1.5 rounded px-1 text-left hover:bg-gray-50"
        >
          <span
            aria-hidden
            className={`inline-block text-xs text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
          >
            ▶
          </span>
          <h2 className="text-sm font-medium text-gray-700">{title}</h2>
          {summary && <span className="text-xs text-gray-400">{summary}</span>}
        </button>
        {actions && open && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
