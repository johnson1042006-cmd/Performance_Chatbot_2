import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";

export interface StaffContext {
  userId: string;
  email: string;
  name: string;
  role: "store_manager" | "support_agent";
}

/**
 * Guard for staff-only API routes (agent OR manager). Mirrors [requireManager]
 * but accepts either authenticated role. Returns either a `StaffContext`
 * (caller continues) or a `NextResponse` (caller returns it).
 *
 * Also enforces the forced-password-reset gate for `/api/*` (moved from
 * middleware in Phase 2): a must-reset staff member gets 403
 * `password_reset_required`.
 *
 * ```ts
 * const guard = await requireStaff();
 * if (guard instanceof NextResponse) return guard;
 * if (guard.role === "store_manager") { ... }
 * ```
 */
export async function requireStaff(): Promise<StaffContext | NextResponse> {
  const session = await getStaffSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    session.user.role !== "store_manager" &&
    session.user.role !== "support_agent"
  ) {
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
    role: session.user.role,
  };
}
