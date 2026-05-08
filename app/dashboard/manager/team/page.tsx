"use client";

import { useState } from "react";
import TopBar from "@/components/ui/TopBar";
import TeamTable from "@/components/dashboard/manager/TeamTable";
import InviteAgentModal from "@/components/dashboard/manager/InviteAgentModal";
import AgentStatsTable from "@/components/dashboard/manager/AgentStatsTable";

export default function TeamPage() {
  const [showInvite, setShowInvite] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <TopBar title="Team" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <TeamTable
          key={refreshKey}
          onInvite={() => setShowInvite(true)}
        />
        <AgentStatsTable days={30} />
        <InviteAgentModal
          open={showInvite}
          onClose={() => setShowInvite(false)}
          onInvited={() => setRefreshKey((k) => k + 1)}
        />
      </div>
    </>
  );
}
