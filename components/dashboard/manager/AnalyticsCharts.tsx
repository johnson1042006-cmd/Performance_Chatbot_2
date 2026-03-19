"use client";

import Card from "@/components/ui/Card";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
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

interface AnalyticsChartsProps {
  dailyStats: DailyStat[];
}

export default function AnalyticsCharts({ dailyStats }: AnalyticsChartsProps) {
  const chartData = dailyStats.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    Total: d.total,
    AI: d.aiCount,
    Human: d.total - d.aiCount,
  }));

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <h3 className="font-semibold text-text-primary mb-4">
          AI vs Human Responses (7 days)
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

      <Card>
        <h3 className="font-semibold text-text-primary mb-4">
          Daily Chat Volume
        </h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#6b7280" />
              <YAxis tick={{ fontSize: 12 }} stroke="#6b7280" />
              <Tooltip />
              <Bar dataKey="Total" fill="#1a1a2e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[240px] flex items-center justify-center text-sm text-text-secondary">
            No data for the last 7 days
          </div>
        )}
      </Card>
    </div>
  );
}
