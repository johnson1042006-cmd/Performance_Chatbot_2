"use client";

import Card from "@/components/ui/Card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface DailyStat {
  date: string;
  total: number;
  aiCount: number;
}

interface Props {
  dailyStats: DailyStat[];
}

export default function WeeklyMixChart({ dailyStats }: Props) {
  const chartData = dailyStats.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    AI: d.aiCount,
    Human: d.total - d.aiCount,
    Total: d.total,
  }));
  return (
    <Card className="h-full">
      <h3 className="font-semibold text-text-primary text-sm mb-3">
        AI vs Human (7 days)
      </h3>
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#6b7280" />
            <YAxis tick={{ fontSize: 12 }} stroke="#6b7280" />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="AI"
              stroke="#7c3aed"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="Human"
              stroke="#e63946"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[240px] flex items-center justify-center text-sm text-text-secondary">
          No data for the last 7 days
        </div>
      )}
    </Card>
  );
}
