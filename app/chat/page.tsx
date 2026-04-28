import { Suspense } from "react";
import ChatWidget from "@/components/chat/ChatWidget";

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-background">
          <div className="animate-pulse text-text-secondary text-sm">
            Loading chat...
          </div>
        </div>
      }
    >
      <ChatWidget />
    </Suspense>
  );
}
