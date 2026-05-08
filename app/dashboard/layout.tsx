import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Sidebar from "@/components/ui/Sidebar";
import PresenceHeartbeat from "@/components/providers/PresenceHeartbeat";
import AlertsBanner from "@/components/dashboard/AlertsBanner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
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
        {children}
      </main>
    </div>
  );
}
