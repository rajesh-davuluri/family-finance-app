"use client";

import { useCallback, useEffect, useState } from "react";
import AddTransactionModal, { type EditableTransaction } from "@/components/AddTransactionModal";
import MoneyTiles from "@/components/MoneyTiles";
import SpendTiles from "@/components/SpendTiles";
import AttentionStrip from "@/components/dashboard/AttentionStrip";
import Overview from "@/components/dashboard/Overview";
import WealthLine from "@/components/dashboard/WealthLine";
import EmergencyFund from "@/components/dashboard/EmergencyFund";
import DrillSheet, { type Drill } from "@/components/dashboard/DrillSheet";
import { announceTransactionsChanged } from "@/lib/events";
import { formatDateTime } from "@/lib/lastActivity";

// The dashboard answers four questions, in order -- is anything wrong, am I
// OK right now, am I on track, where is the money going -- with no
// transaction lists of its own: every number opens what's behind it in a
// sheet (DrillSheet). Records and activity live on their own pages.
export default function DashboardPage() {
  const [me, setMe] = useState<{ name: string; lastLoginAt: string | null; previousLoginAt: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditableTransaction | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const closeDrill = useCallback(() => setDrill(null), []);
  const changed = () => {
    setAdding(false);
    setEditing(null);
    announceTransactionsChanged();
  };

  async function remove(id: string) {
    if (!confirm("Delete this transaction?")) return;
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    setEditing(null);
    announceTransactionsChanged();
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          {me && (
            <p className="text-xs text-gray-500">
              {/* lastLoginAt is this session, so "last login" means the one before it. */}
              {me.previousLoginAt
                ? `Welcome back, ${me.name} — your last login was ${formatDateTime(me.previousLoginAt)}.`
                : me.lastLoginAt
                  ? `Welcome, ${me.name} — this is your first recorded login.`
                  : `Welcome, ${me.name}.`}
            </p>
          )}
        </div>
        {/* On a phone or tablet the bottom bar's + does this. */}
        <button
          onClick={() => setAdding(true)}
          className="hidden rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 lg:block"
        >
          Add Transaction
        </button>
      </div>

      {/* 1. Is anything wrong? */}
      <AttentionStrip />

      {/* 2. Am I OK right now? Bank money, safe to spend, card bills. */}
      <MoneyTiles onDrill={setDrill} />

      {/* 3 & 4. On track? Where is it going? (everyday spending between the period and the trend) */}
      <Overview onDrill={setDrill}>
        <SpendTiles />
      </Overview>

      <EmergencyFund />

      <WealthLine />

      {/* The sheet stays open under the edit form, and refreshes after a save. */}
      <DrillSheet drill={drill} onClose={closeDrill} onEdit={setEditing} />
      <AddTransactionModal
        open={adding || !!editing}
        editingTransaction={editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSuccess={changed}
        onDelete={remove}
      />
    </div>
  );
}
