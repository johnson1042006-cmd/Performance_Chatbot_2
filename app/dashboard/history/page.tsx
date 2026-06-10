"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import TopBar from "@/components/ui/TopBar";
import HistoryTable from "@/components/dashboard/manager/HistoryTable";
import TranscriptModal from "@/components/dashboard/TranscriptModal";

function HistoryContent() {
  // Deep-links like /dashboard/history?sessionId=… (from the Feedback page)
  // open the transcript directly.
  const searchParams = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(
    searchParams.get("sessionId")
  );

  return (
    <>
      <div className="flex-1 overflow-y-auto p-6">
        <HistoryTable onSelectSession={(id) => setOpenId(id)} />
      </div>

      {openId && (
        <TranscriptModal
          sessionId={openId}
          title="Transcript"
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

export default function HistoryPage() {
  return (
    <>
      <TopBar title="Chat History" />
      <Suspense fallback={<div className="flex-1 p-6" />}>
        <HistoryContent />
      </Suspense>
    </>
  );
}
