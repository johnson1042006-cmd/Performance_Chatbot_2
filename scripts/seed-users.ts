import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { createDb } from "../lib/db/connect";
import { users } from "../lib/db/schema";

// The credentials that shipped in older docs/seeds. We refuse to seed these
// so a copy/paste of the leaked values can never reach a real environment.
const LEAKED_DEFAULTS = new Set(["manager123", "agent123"]);

/**
 * Resolve a seed password from an env var. Refuses the known-leaked defaults.
 * When the env var is absent, generates a strong random password and prints it
 * once so the operator can record it (the user is forced to reset on login).
 */
function resolvePassword(envVar: string, label: string): string {
  const provided = process.env[envVar];
  if (provided && provided.length > 0) {
    if (LEAKED_DEFAULTS.has(provided)) {
      console.error(
        `Refusing to seed: ${envVar} is set to a known leaked default. Set it to a new, strong password.`
      );
      process.exit(1);
    }
    return provided;
  }
  const generated = randomBytes(18).toString("base64url");
  console.log(
    `[seed] ${envVar} not set — generated a strong random ${label} password (shown once): ${generated}`
  );
  return generated;
}

/** Create the Supabase auth user, or update its password if it already exists. Returns the auth user id. */
async function upsertAuthUser(
  admin: SupabaseClient,
  email: string,
  password: string,
  name: string
): Promise<string> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
    });
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  return data.user.id;
}

async function seed() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { db, client } = createDb();

  const seeds = [
    {
      email: "manager@performancecycle.com",
      name: "Store Manager",
      role: "store_manager" as const,
      password: resolvePassword("SEED_MANAGER_PASSWORD", "manager"),
    },
    {
      email: "agent@performancecycle.com",
      name: "Support Agent",
      role: "support_agent" as const,
      password: resolvePassword("SEED_AGENT_PASSWORD", "agent"),
    },
  ];

  for (const s of seeds) {
    const id = await upsertAuthUser(admin, s.email, s.password, s.name);
    // Mirror/refresh the public.users profile. onConflict flips
    // mustResetPassword=true on re-runs — the security backstop: default
    // credentials must NEVER stay valid past first login.
    await db
      .insert(users)
      .values({
        id,
        email: s.email,
        role: s.role,
        name: s.name,
        mustResetPassword: true,
        passwordUpdatedAt: null,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { mustResetPassword: true },
      });
  }

  console.log(
    "Seeded/updated 2 users (manager + agent) with mustResetPassword=true"
  );

  await client.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
