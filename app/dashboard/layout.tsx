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
      <PresenceHeartbeat />
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <AlertsBanner />
        {children}
      </main>
    </div>
  );
}
