"use client";

import TopBar from "@/components/ui/TopBar";
import BotSettings from "@/components/dashboard/manager/BotSettings";

export default function ConfigurePage() {
  return (
    <>
      <TopBar title="Configure" />
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
        <BotSettings />
      </div>
    </>
  );
}
