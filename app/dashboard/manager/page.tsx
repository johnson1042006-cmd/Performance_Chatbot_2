"use client";

import { useState, useEffect } from "react";
import TopBar from "@/components/ui/TopBar";
import MetricCard from "@/components/dashboard/manager/MetricCard";
import AnalyticsCharts from "@/components/dashboard/manager/AnalyticsCharts";
import RecentConversations from "@/components/dashboard/manager/RecentConversations";

interface Analytics {
  chatsToday: number;
  aiPercent: number;
  openChats: number;
  totalMessages: number;
  recentSessions: Array<{
    id: string;
    customerIdentifier: string;
    pageContext: Record<string, unknown> | null;
    startedAt: string;
    status: string;
  }>;
  dailyStats: Array<{
    date: string;
    total: number;
    aiCount: number;
  }>;
}

export default function ManagerDashboard() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((res) => res.json())
      .then((data) => setAnalytics(data))
      .catch(console.error);
  }, []);

  return (
    <>
      <TopBar title="Hub" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-4 gap-4 mb-6">
          <MetricCard
            title="Chats Today"
            value={analytics?.chatsToday ?? 0}
            subtitle="Total sessions"
          />
          <MetricCard
            title="AI Handled"
            value={`${analytics?.aiPercent ?? 0}%`}
            subtitle={`${100 - (analytics?.aiPercent ?? 0)}% human`}
            accent
          />
          <MetricCard
            title="Total Messages"
            value={analytics?.totalMessages ?? 0}
            subtitle="Today"
          />
          <MetricCard
            title="Open Chats"
            value={analytics?.openChats ?? 0}
            subtitle="Active sessions"
          />
        </div>

        <div className="mb-6">
          <AnalyticsCharts dailyStats={analytics?.dailyStats || []} />
        </div>

        <RecentConversations sessions={analytics?.recentSessions || []} />
      </div>
    </>
  );
}
