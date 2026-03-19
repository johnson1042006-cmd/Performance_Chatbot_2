"use client";

import TopBar from "@/components/ui/TopBar";
import HistoryTable from "@/components/dashboard/manager/HistoryTable";

export default function HistoryPage() {
  return (
    <>
      <TopBar title="Chat History" />
      <div className="flex-1 overflow-y-auto p-6">
        <HistoryTable />
      </div>
    </>
  );
}
