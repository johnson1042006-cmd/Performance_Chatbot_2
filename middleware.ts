import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Phase 2 (Supabase Auth): the middleware is intentionally thin. It runs on the
 * edge runtime, which cannot query Postgres, and the Supabase JWT carries only
 * identity (not the app role or mustResetPassword flag — those stay in
 * public.users, read in Node). So it does exactly two things:
 *   1. updateSession() — refresh the Supabase auth cookie on every matched
 *      request (mandatory; skipping it silently logs users out).
 *   2. Authenticated-gate: redirect unauthenticated users away from /dashboard
 *      and /password-reset to /login.
 *
 * The role gate (/dashboard/manager/*) and the forced-reset gate moved to Node
 * server layers: app/dashboard/manager/layout.tsx + app/dashboard/layout.tsx
 * for pages, and requireManager/requireStaff for /api/* routes. API paths pass
 * through here — route handlers do their own authorization (and some
 * /api/sessions endpoints are customer-facing with no Supabase session).
 */
export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const path = request.nextUrl.pathname;

  const needsAuth =
    path.startsWith("/dashboard") || path === "/password-reset";
  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/password-reset",
    // Staff-facing API groups — matched so the Supabase auth cookie is
    // refreshed on these requests (route handlers still self-authorize).
    "/api/admin/:path*",
    "/api/analytics/:path*",
    "/api/sessions/:path*",
    "/api/canned/:path*",
    "/api/presence/:path*",
    "/api/pairings/:path*",
    "/api/push/:path*",
  ],
};
