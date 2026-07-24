"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useStaffUser } from "@/components/providers/StaffSessionProvider";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  History,
  BookOpen,
  Settings,
  Users,
  ThumbsUp,
  LogOut,
  Search,
  TrendingUp,
  ListChecks,
  BellRing,
  BellOff,
} from "lucide-react";
import Badge from "./Badge";
import { DASHBOARD_CHANNEL } from "@/lib/pusher/channels";
import AlertsBell from "@/components/dashboard/AlertsBell";
import { notifyEscalation } from "@/components/dashboard/notifyEscalation";
import { usePushNotifications } from "@/components/dashboard/usePushNotifications";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  managerOnly?: boolean;
}

const navItems: NavItem[] = [
  {
    label: "Hub",
    href: "/dashboard",
    icon: <LayoutDashboard size={20} />,
  },
  {
    label: "Live Chats",
    href: "/dashboard/chats",
    icon: <MessageSquare size={20} />,
  },
  {
    label: "History",
    href: "/dashboard/history",
    icon: <History size={20} />,
  },
  {
    label: "Search",
    href: "/dashboard/manager/search",
    icon: <Search size={20} />,
    managerOnly: true,
  },
  {
    label: "Insights",
    href: "/dashboard/manager/insights",
    icon: <TrendingUp size={20} />,
    managerOnly: true,
  },
  {
    label: "Review",
    href: "/dashboard/manager/review",
    icon: <ListChecks size={20} />,
    managerOnly: true,
  },
  {
    label: "Knowledge Base",
    href: "/dashboard/manager/knowledge",
    icon: <BookOpen size={20} />,
    managerOnly: true,
  },
  {
    label: "Configure",
    href: "/dashboard/manager/configure",
    icon: <Settings size={20} />,
    managerOnly: true,
  },
  {
    label: "Team",
    href: "/dashboard/manager/team",
    icon: <Users size={20} />,
    managerOnly: true,
  },
  {
    label: "Feedback",
    href: "/dashboard/manager/feedback",
    icon: <ThumbsUp size={20} />,
    managerOnly: true,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const session = useStaffUser();
  const role = session?.user?.role;
  const isManager = role === "store_manager";
  const push = usePushNotifications();
  const [unclaimedCount, setUnclaimedCount] = useState(0);

  const filteredItems = navItems.filter(
    (item) => !item.managerOnly || isManager
  );

  const fetchUnclaimedCount = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) return;
      const data = await res.json();
      setUnclaimedCount(data.unclaimedCount ?? 0);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchUnclaimedCount();

    // Listen for Pusher dashboard events. The "dashboard" channel is shared
    // with SessionQueue and other widgets — only unbind our own handler
    // references and release via the ref-counted helper.
    let pusherCleanup = () => {};
    import("@/lib/pusher/client")
      .then(({ acquireChannel, releaseChannel }) => {
        const channel = acquireChannel(DASHBOARD_CHANNEL);
        const onSessionUpdate = (
          payload:
            | {
                sessionId?: string;
                autoEscalated?: boolean;
                reason?: string;
                requestedHuman?: boolean;
              }
            | undefined
        ) => {
          fetchUnclaimedCount();
          if (payload?.autoEscalated || payload?.requestedHuman) {
            notifyEscalation({
              sessionId: payload.sessionId ?? "",
              reason: payload.reason ?? "explicit_request",
              urgency: "normal",
            });
          }
        };
        const onEscalationRequested = (payload: {
          sessionId: string;
          reason: string;
          urgency: string;
        }) => {
          fetchUnclaimedCount();
          notifyEscalation(payload);
        };
        channel.bind("session-update", onSessionUpdate);
        channel.bind("session-claimed", fetchUnclaimedCount);
        channel.bind("session-released", fetchUnclaimedCount);
        channel.bind("session-closed", fetchUnclaimedCount);
        channel.bind("escalation-requested", onEscalationRequested);
        pusherCleanup = () => {
          channel.unbind("session-update", onSessionUpdate);
          channel.unbind("session-claimed", fetchUnclaimedCount);
          channel.unbind("session-released", fetchUnclaimedCount);
          channel.unbind("session-closed", fetchUnclaimedCount);
          channel.unbind("escalation-requested", onEscalationRequested);
          releaseChannel(DASHBOARD_CHANNEL);
        };
      })
      .catch(() => {});

    return () => {
      pusherCleanup();
    };
  }, [fetchUnclaimedCount]);

  return (
    <aside className="w-60 h-screen bg-primary flex flex-col shrink-0">
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-white rounded-button flex items-center justify-center overflow-hidden">
            <Image src="/performance-cycle-logo.png" alt="Performance Cycle" width={32} height={32} className="w-full h-full object-contain p-0.5" />
          </div>
          <span className="text-white font-semibold text-sm">
            Performance Cycle
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {filteredItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          const isLiveChats = item.href === "/dashboard/chats";
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-button text-sm transition-colors ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {isLiveChats && unclaimedCount > 0 && (
                <span className="ml-auto bg-amber-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {unclaimedCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-medium">
            {session?.user?.name?.charAt(0) || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">
              {session?.user?.name || "Agent"}
            </p>
            <Badge variant={isManager ? "warning" : "info"} className="mt-0.5">
              {isManager ? "Manager" : "Agent"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-success" />
          <span className="text-white/60 text-xs">Online</span>
          <div className="ml-auto flex items-center gap-3">
            {push.supported && (
              <button
                type="button"
                onClick={() => (push.enabled ? push.disable() : push.enable())}
                disabled={push.busy}
                aria-label={push.enabled ? "Disable desktop notifications" : "Enable desktop notifications"}
                title={push.enabled ? "Desktop notifications on — click to turn off" : "Enable desktop notifications for new chats & escalations"}
                className="text-white/60 hover:text-white transition-colors disabled:opacity-40"
              >
                {push.enabled ? <BellRing size={16} /> : <BellOff size={16} />}
              </button>
            )}
            <AlertsBell />
            <button
              onClick={async () => {
                // Clear agent presence before signing out so anyAgentsOnline()
                // returns false immediately rather than waiting up to 60 s for
                // the heartbeat window to expire. Best-effort — sign-out
                // proceeds regardless of whether the beacon lands.
                navigator.sendBeacon("/api/presence/offline");
                await createClient().auth.signOut();
                window.location.href = "/login";
              }}
              className="text-white/40 hover:text-white transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
