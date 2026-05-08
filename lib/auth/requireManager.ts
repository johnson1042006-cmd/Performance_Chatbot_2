import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export interface ManagerContext {
  userId: string;
  email: string;
  name: string;
  role: "store_manager";
}

/**
 * Guard for manager-only API routes. Returns either a `ManagerContext`
 * (caller continues) or a `NextResponse` (caller returns it). Mirrors the
 * pattern in [app/api/admin/users/route.ts] but is route-agnostic and
 * keeps every Phase 5 admin endpoint a single line of authorization.
 *
 * ```ts
 * const guard = await requireManager();
 * if (guard instanceof NextResponse) return guard;
 * // guard.userId is the manager's id
 * ```
 */
export async function requireManager(): Promise<ManagerContext | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "store_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: "store_manager",
  };
}
