import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";

export default async function DashboardIndex() {
  const session = await getStaffSession();

  if (!session) redirect("/login");

  if (session.user.role === "store_manager") {
    redirect("/dashboard/manager");
  } else {
    redirect("/dashboard/agent");
  }
}
