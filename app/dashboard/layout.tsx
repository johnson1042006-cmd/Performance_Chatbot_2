import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { StaffSessionProvider } from "@/components/providers/StaffSessionProvider";
import Sidebar from "@/components/ui/Sidebar";
import PresenceHeartbeat from "@/components/providers/PresenceHeartbeat";
import AlertsBanner from "@/components/dashboard/AlertsBanner";
import DesktopNotificationPrompt from "@/components/dashboard/DesktopNotificationPrompt";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");

  // Forced first-login password change — moved here from middleware in Phase 2
  // (edge middleware can no longer read the flag from public.users). The API
  // side of this gate lives in requireManager/requireStaff (403).
  if (session.user.mustResetPassword) redirect("/password-reset");

  return (
    <StaffSessionProvider value={{ user: session.user }}>
      <div className="flex h-screen overflow-hidden bg-background">
        <a
          href="#dashboard-main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[10000] focus:bg-white focus:text-text-primary focus:px-3 focus:py-2 focus:rounded-button focus:shadow"
        >
          Skip to main content
        </a>
        <PresenceHeartbeat />
        <Sidebar />
        <main
          id="dashboard-main"
          className="flex-1 flex flex-col overflow-hidden"
        >
          <AlertsBanner />
          <DesktopNotificationPrompt />
          {children}
        </main>
      </div>
    </StaffSessionProvider>
  );
}
