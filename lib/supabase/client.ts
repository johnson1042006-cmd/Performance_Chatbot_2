import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client for Client Components. Uses the publishable key
 * (browser-safe). Reads/writes the auth session from cookies shared with the
 * server client, so sign-in/sign-out stay in sync across server and browser.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
