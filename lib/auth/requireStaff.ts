import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export interface StaffContext {
  userId: string;
  email: string;
  name: string;
  role: "store_manager" | "support_agent";
}

/**
 * Guard for staff-only API routes (agent OR manager). Mirrors
 * [requireManager] but accepts either authenticated role. Used by the
 * Phase 5.5 ticket routes so agents can list and edit their own tickets
 * while managers retain global access. Returns either a `StaffContext`
 * (caller continues) or a `NextResponse` (caller returns it).
 *
 * ```ts
 * const guard = await requireStaff();
 * if (guard instanceof NextResponse) return guard;
 * if (guard.role === "store_manager") { ... }
 * ```
 */
export async function requireStaff(): Promise<StaffContext | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    session.user.role !== "store_manager" &&
    session.user.role !== "support_agent"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}
