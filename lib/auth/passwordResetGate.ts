import { NextResponse } from "next/server";
import type { StaffSession } from "@/lib/auth";

/**
 * Forced-password-reset gate for staff API routes. Under NextAuth this lived
 * in the edge middleware (which could read `mustResetPassword` from the JWT);
 * after Phase 2 the flag lives in `public.users`, so the gate runs in the
 * Node route handlers instead — call it immediately after `getStaffSession()`,
 * BEFORE any role checks, to preserve the old middleware's precedence.
 *
 * Returns the 403 response to send when the session is a must-reset staffer,
 * or null when the request may proceed (including when there is no staff
 * session at all — customer/unauthenticated requests are not this gate's
 * concern).
 *
 * ```ts
 * const session = await getStaffSession();
 * const resetDenied = passwordResetGate(session);
 * if (resetDenied) return resetDenied;
 * ```
 */
export function passwordResetGate(
  session: StaffSession | null
): NextResponse | null {
  if (session?.user?.mustResetPassword) {
    return NextResponse.json(
      { error: "password_reset_required" },
      { status: 403 }
    );
  }
  return null;
}
