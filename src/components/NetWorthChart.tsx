"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type TrendPoint = { month: string; assets: number; liabilities: number; netWorth: number };

export function NetWorthTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
        <Legend />
        <Line type="monotone" dataKey="assets" stroke="#4B7B5A" strokeWidth={2} name="Assets" />
        <Line type="monotone" dataKey="liabilities" stroke="#A0463A" strokeWidth={2} name="Liabilities" />
        <Line type="monotone" dataKey="netWorth" stroke="#1C2B3A" strokeWidth={3} name="Net Worth" />
      </LineChart>
    </ResponsiveContainer>
  );
}
