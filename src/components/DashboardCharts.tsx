"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

type CategorySlice = { id: string; name: string; total: number };

const COLORS = {
  expense: { base: "#dc2626", selected: "#991b1b" },
  income: { base: "#16a34a", selected: "#166534" },
};

export function CategoryBarChart({
  data,
  tone,
  onCategoryClick,
  selectedCategoryId,
}: {
  data: CategorySlice[];
  tone: "income" | "expense";
  onCategoryClick?: (category: CategorySlice) => void;
  selectedCategoryId?: string | null;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No {tone === "income" ? "income" : "expenses"} in this period.</p>;
  }
  const colors = COLORS[tone];
  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-20} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
          <Bar
            dataKey="total"
            radius={[4, 4, 0, 0]}
            cursor={onCategoryClick ? "pointer" : undefined}
            onClick={(entry: any) => onCategoryClick?.(entry as CategorySlice)}
          >
            {data.map((entry) => (
              <Cell key={entry.id} fill={entry.id === selectedCategoryId ? colors.selected : colors.base} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {onCategoryClick && <p className="text-center text-xs text-gray-400">Click a bar to see the transactions behind it.</p>}
    </div>
  );
}
