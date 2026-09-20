"use client";

import { useEffect, useState } from "react";
import { NetWorthTrendChart } from "@/components/NetWorthChart";

type NetWorthData = {
  assets: number;
  liabilities: number;
  netWorth: number;
  untrackedInstrumentCount: number;
  trend: { month: string; assets: number; liabilities: number; netWorth: number }[];
};

export default function NetWorthPage() {
  const [data, setData] = useState<NetWorthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/net-worth")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  if (loading || !data) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Net Worth</h1>
        <p className="text-sm text-gray-500">Approx. USD — assets (accounts with a balance set) minus active debts.</p>
      </div>

      <div className="rounded-lg border bg-white p-6 text-center">
        <p className="text-sm text-gray-500">Net Worth</p>
        <p className={`font-display mt-1 text-4xl font-semibold ${data.netWorth >= 0 ? "text-income-600" : "text-expense-600"}`}>
          ${data.netWorth.toFixed(2)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Assets</p>
          <p className="font-display mt-1 text-2xl font-semibold text-income-600">${data.assets.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Liabilities</p>
          <p className="font-display mt-1 text-2xl font-semibold text-expense-600">${data.liabilities.toFixed(2)}</p>
        </div>
      </div>

      {data.untrackedInstrumentCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {data.untrackedInstrumentCount} account{data.untrackedInstrumentCount === 1 ? "" : "s"} without an opening
          balance set {data.untrackedInstrumentCount === 1 ? "isn't" : "aren't"} counted here yet — set one on the{" "}
          <a href="/instruments" className="underline">
            Instruments
          </a>{" "}
          page for a complete picture.
        </div>
      )}

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-medium text-gray-700">6-month trend</h2>
        <NetWorthTrendChart data={data.trend} />
      </div>
    </div>
  );
}
