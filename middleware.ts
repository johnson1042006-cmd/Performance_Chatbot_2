import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    // Force first-login password change before any protected page renders.
    // The reset page itself is exempt so the user can submit the form, and
    // the NextAuth API routes are exempt so sign-out and CSRF still work.
    if (
      token?.mustResetPassword === true &&
      path !== "/password-reset" &&
      !path.startsWith("/api/auth")
    ) {
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
        return true;
      },
    },
  }
);

export const config = {
  matcher: ["/dashboard/:path*", "/password-reset"],
};
