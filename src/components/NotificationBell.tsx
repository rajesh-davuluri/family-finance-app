"use client";

import { useEffect, useRef, useState } from "react";

type NotificationItem = { id: string; message: string; read: boolean; createdAt: string };

export default function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function load() {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setUnreadCount(d.unreadCount ?? 0);
      });
  }

  useEffect(() => {
    load();
    // Poll every 60s so the badge updates if the other person adds
    // something while you're already on the page, without needing a
    // websocket/push setup for a two-person household.
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      await fetch("/api/notifications/read-all", { method: "PATCH" });
      setUnreadCount(0);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={handleOpen} className="relative text-ink-300 hover:text-white" aria-label="Notifications">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6.5V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v4.5L3 18v1h18v-1l-2-2.5Z" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-expense-600 text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-md border border-ink-600 bg-ink-800 py-1 shadow-lg">
          <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-300">Notifications</p>
          {items.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-300">Nothing yet.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <div key={n.id} className="border-t border-ink-600 px-4 py-2.5 text-sm text-ink-100 first:border-t-0">
                  <p>{n.message}</p>
                  <p className="mt-0.5 text-xs text-ink-300">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
