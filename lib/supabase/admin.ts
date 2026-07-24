import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for privileged auth operations: admin.createUser
 * (invites, seeding), admin.updateUserById (password rotation/reset),
 * admin.deleteUser. Uses the SECRET key and bypasses RLS.
 *
 * SECURITY: the `server-only` import above makes the build fail if this module
 * is ever pulled into a Client Component. SUPABASE_SECRET_KEY must never be
 * exposed to the browser (never NEXT_PUBLIC_). Do not import this from any
 * "use client" file.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY."
    );
  }
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
