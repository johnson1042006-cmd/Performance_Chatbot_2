"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import TopBar from "@/components/ui/TopBar";
import Badge from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { AlertTriangle } from "lucide-react";
import MetricCard from "@/components/dashboard/manager/MetricCard";
import RecentConversations from "@/components/dashboard/manager/RecentConversations";

interface Analytics {
  queueSize: number;
  unclaimedCount: number;
  chatsToday: number;
  openChats: number;
  recentSessions: Array<{
    id: string;
    customerIdentifier: string;
    pageContext: Record<string, unknown> | null;
    startedAt: string;
    status: string;
  }>;
}

export default function AgentDashboard() {
  const { data: session } = useSession();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("/api/analytics")
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

  const firstName = session?.user?.name?.split(" ")[0] || "Agent";

  return (
    <>
      <TopBar title="Hub">
        <Badge variant="success" dot>
          Online
        </Badge>
      </TopBar>
      <div className="flex-1 overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          Welcome back, {firstName}
        </h2>

        {loadError && (
          <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-card border border-red-200 bg-red-50 text-sm text-red-800">
            <AlertTriangle size={16} className="shrink-0" />
            Couldn&apos;t load dashboard metrics. Refresh to try again.
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <MetricCard
              title="Queued"
              value={analytics?.unclaimedCount ?? 0}
              subtitle="Waiting for an agent"
              accent={Boolean(analytics?.unclaimedCount)}
            />
            <MetricCard
              title="Chats Today"
              value={analytics?.chatsToday ?? 0}
              subtitle="Total sessions"
            />
            <MetricCard
              title="Open Chats"
              value={analytics?.openChats ?? 0}
              subtitle="Active sessions"
            />
          </div>
        )}

        <RecentConversations sessions={analytics?.recentSessions || []} />
      </div>
    </>
  );
}
