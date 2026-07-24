import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";

/**
 * Manager-only gate for /dashboard/manager/*. Moved here from middleware in
 * Phase 2: edge middleware can no longer read the role from public.users
 * (it's not in the Supabase JWT — deferred to Phase 4). The API side of this
 * gate lives in requireManager(). Agents are bounced to their own hub.
 *
 * The parent dashboard layout already enforced authenticated + not-must-reset,
 * so here we only need the role check.
 */
export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  if (session.user.role !== "store_manager") redirect("/dashboard/agent");

  return <>{children}</>;
}
