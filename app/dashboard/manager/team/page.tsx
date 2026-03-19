"use client";

import { useState } from "react";
import TopBar from "@/components/ui/TopBar";
import TeamTable from "@/components/dashboard/manager/TeamTable";
import InviteAgentModal from "@/components/dashboard/manager/InviteAgentModal";

export default function TeamPage() {
  const [showInvite, setShowInvite] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <TopBar title="Team" />
      <div className="flex-1 overflow-y-auto p-6">
        <TeamTable
          key={refreshKey}
          onInvite={() => setShowInvite(true)}
        />
        <InviteAgentModal
          open={showInvite}
          onClose={() => setShowInvite(false)}
          onInvited={() => setRefreshKey((k) => k + 1)}
        />
      </div>
    </>
  );
}
