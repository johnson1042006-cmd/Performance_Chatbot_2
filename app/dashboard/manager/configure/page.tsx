"use client";

import TopBar from "@/components/ui/TopBar";
import BotSettings from "@/components/dashboard/manager/BotSettings";
import AlertsConfig from "@/components/dashboard/manager/AlertsConfig";

export default function ConfigurePage() {
  return (
    <>
      <TopBar title="Configure" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl">
        <BotSettings />
        <AlertsConfig />
      </div>
    </>
  );
}
