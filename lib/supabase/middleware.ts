import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresh the Supabase auth session cookie on every matched request and return
 * the user. Server Components can't write cookies, so this middleware helper is
 * the single place the auth token is rotated — skipping it silently logs users
 * out. Uses getUser() (revalidates the JWT against the Auth server), never
 * getSession() (trusts unvalidated cookie data).
 *
 * Returns { response, user }. The caller (middleware.ts) decides redirects; it
 * MUST return this exact `response` object (or copy its cookies) so refreshed
 * auth cookies reach the browser.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
