import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";

export interface ManagerContext {
  userId: string;
  email: string;
  name: string;
  role: "store_manager";
}

/**
 * Guard for manager-only API routes. Returns either a `ManagerContext`
 * (caller continues) or a `NextResponse` (caller returns it). Keeps every
 * admin endpoint a single line of authorization.
 *
 * Also enforces the forced-password-reset gate for `/api/*` — this moved here
 * from middleware in Phase 2, since edge middleware can no longer read the flag
 * from public.users. A must-reset manager gets 403 `password_reset_required`.
 *
 * ```ts
 * const guard = await requireManager();
 * if (guard instanceof NextResponse) return guard;
 * // guard.userId is the manager's id
 * ```
 */
export async function requireManager(): Promise<ManagerContext | NextResponse> {
  const session = await getStaffSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "store_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.mustResetPassword) {
    return NextResponse.json(
      { error: "password_reset_required" },
      { status: 403 }
    );
  }
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: "store_manager",
  };
}
