import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";

/**
 * Staff session shape used across the dashboard/API. Identity comes from
 * Supabase Auth; role/isActive/name/mustResetPassword are the app's own
 * profile columns in public.users (Phase 2 keeps public.users as the authz
 * source of truth — role is NOT in the Supabase JWT; that's deferred to Phase 4).
 */
export interface StaffSession {
  user: {
    id: string;
    email: string;
    name: string;
    role: "store_manager" | "support_agent";
    mustResetPassword: boolean;
  };
}

type Profile = {
  role: "store_manager" | "support_agent";
  name: string;
  isActive: boolean;
  mustReset: boolean;
};

// In-memory cache so the per-request profile lookup isn't a DB hit on every
// call. 60s is short enough that an admin clearing a reset flag / deactivating
// a user is reflected quickly, long enough that hot pages don't hammer the
// users table. Bust explicitly via bustUserFlagCache(userId) after a reset.
type CacheEntry = { profile: Profile | null; expiresAt: number };
const userFlagCache = new Map<string, CacheEntry>();

async function loadProfile(userId: string): Promise<Profile | null> {
  const hit = userFlagCache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.profile;

  try {
    const [row] = await db
      .select({
        role: users.role,
        name: users.name,
        isActive: users.isActive,
        mustReset: users.mustResetPassword,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const profile: Profile | null = row
      ? {
          role: row.role,
          name: row.name,
          isActive: row.isActive,
          mustReset: !!row.mustReset,
        }
      : null;
    userFlagCache.set(userId, { profile, expiresAt: Date.now() + 60_000 });
    return profile;
  } catch {
    return null;
  }
}

export function bustUserFlagCache(userId: string): void {
  userFlagCache.delete(userId);
}

/**
 * Resolve the current staff session from the Supabase auth cookie. Returns null
 * when there is no authenticated Supabase user, when the user has no profile
 * row, or when the profile is deactivated (isActive=false → immediate access
 * loss, since RLS isn't in play yet). Uses getUser() (revalidates the JWT
 * against the Auth server), never getSession().
 */
export async function getStaffSession(): Promise<StaffSession | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await loadProfile(user.id);
  if (!profile || !profile.isActive) return null;

  return {
    user: {
      id: user.id,
      email: user.email ?? "",
      name: profile.name,
      role: profile.role,
      mustResetPassword: profile.mustReset,
    },
  };
}
