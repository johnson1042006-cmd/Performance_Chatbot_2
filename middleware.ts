import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    // Force first-login password change before any protected page renders.
    // The reset page itself is exempt so the user can submit the form, and
    // the NextAuth API routes are exempt so sign-out and CSRF still work.
    // Staff API routes get a 403 (a redirect makes no sense for fetch calls)
    // so a must-reset user can't keep operating the dashboard via direct
    // API requests.
    if (
      token?.mustResetPassword === true &&
      path !== "/password-reset" &&
      !path.startsWith("/api/auth")
    ) {
      if (path.startsWith("/api/")) {
        return NextResponse.json(
          { error: "password_reset_required" },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL("/password-reset", req.url));
    }

    if (path.startsWith("/dashboard/manager") && token?.role !== "store_manager") {
      return NextResponse.redirect(new URL("/dashboard/agent", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const path = req.nextUrl.pathname;
        if (path.startsWith("/dashboard") || path === "/password-reset") {
          return !!token;
        }
        // API paths pass through: route handlers do their own auth (and some
        // /api/sessions endpoints are customer-facing with no NextAuth token).
        // The middleware body above still enforces forced password reset for
        // any logged-in staff token.
        return true;
      },
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/password-reset",
    // Staff-facing API groups — included so the forced-reset guard applies.
    "/api/admin/:path*",
    "/api/analytics/:path*",
    "/api/sessions/:path*",
    "/api/canned/:path*",
    "/api/presence/:path*",
    "/api/pairings/:path*",
    "/api/push/:path*",
  ],
};
