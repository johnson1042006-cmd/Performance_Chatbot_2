"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/ui/TopBar";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { AlertTriangle } from "lucide-react";
import MetricCard from "@/components/dashboard/manager/MetricCard";
import RecentConversations from "@/components/dashboard/manager/RecentConversations";
import WeeklyMixChart from "@/components/dashboard/manager/WeeklyMixChart";
import CsatCard from "@/components/dashboard/manager/CsatCard";
import TopIntentsCompact from "@/components/dashboard/manager/TopIntentsCompact";
import AgentStatsTable from "@/components/dashboard/manager/AgentStatsTable";
interface Analytics {
  chatsToday: number;
  aiPercent: number;
  aiHandledCleanlyPct: number;
  openChats: number;
  unclaimedCount: number;
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("/api/analytics", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setAnalytics(data))
      .catch((err) => {
        console.error(err);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopBar title="Hub" />
      <div className="flex-1 overflow-y-auto p-6">
        {loadError && (
          <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-card border border-red-200 bg-red-50 text-sm text-red-800">
            <AlertTriangle size={16} className="shrink-0" />
            Couldn&apos;t load dashboard metrics. Refresh to try again.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
          {/* Row 1 — today metrics (5 tiles, sub-grid for mobile collapse) */}
          {loading ? (
            <div className="col-span-12 grid grid-cols-1 sm:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : (
          <div className="col-span-12 grid grid-cols-1 sm:grid-cols-5 gap-4">
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
              title="AI Handled Cleanly"
              value={`${analytics?.aiHandledCleanlyPct ?? 0}%`}
              subtitle="No escalation, low conf, or thumbs-down"
            />
            <MetricCard
              title="Open Chats"
              value={analytics?.openChats ?? 0}
              subtitle="Active sessions"
            />
            <MetricCard
              title="Queued"
              value={analytics?.unclaimedCount ?? 0}
              subtitle="Waiting for agent"
              accent={Boolean(analytics?.unclaimedCount)}
            />
          </div>
          )}

          {/* Row 2 — alerts banner is rendered globally in app/dashboard/layout */}

          {/* Row 3 — weekly chart + CSAT */}
          <div className="col-span-12 sm:col-span-7">
            <WeeklyMixChart dailyStats={analytics?.dailyStats || []} />
          </div>
          <div className="col-span-12 sm:col-span-5">
            <CsatCard />
          </div>

          {/* Row 4 — intents / agent leaderboard */}
          <div className="col-span-12 sm:col-span-6">
            <TopIntentsCompact days={7} />
          </div>
          <div className="col-span-12 sm:col-span-6">
            <AgentStatsTable compact days={7} />
          </div>

          {/* Row 5 — recent conversations */}
          <div className="col-span-12">
            <RecentConversations sessions={analytics?.recentSessions || []} />
          </div>
        </div>
      </div>
    </>
  );
}
