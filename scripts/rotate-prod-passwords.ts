import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { createDb } from "../lib/db/connect";
import { users } from "../lib/db/schema";

// One-off rotation for the two seeded accounts. Sets fresh passwords in
// Supabase Auth and forces a password reset on next login. Run after any
// concern that the old seeded credentials may have been exposed.
const LEAKED_DEFAULTS = new Set(["manager123", "agent123"]);

function requirePassword(envVar: string): string {
  const provided = process.env[envVar];
  if (!provided || provided.length === 0) {
    console.error(`Missing required env var: ${envVar}`);
    process.exit(1);
  }
  if (LEAKED_DEFAULTS.has(provided)) {
    console.error(
      `Refusing to rotate: ${envVar} is set to a known leaked default. Choose a new, strong password.`
    );
    process.exit(1);
  }
  return provided;
}

async function rotate() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { db, client } = createDb();

  const managerPassword = requirePassword("SEED_MANAGER_PASSWORD");
  const agentPassword = requirePassword("SEED_AGENT_PASSWORD");

  const updates: { email: string; password: string }[] = [
    { email: "manager@performancecycle.com", password: managerPassword },
    { email: "agent@performancecycle.com", password: agentPassword },
  ];

  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });

  for (const { email, password } of updates) {
    const authUser = list?.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );
    if (!authUser) {
      console.warn(`[rotate] no auth user found for ${email} — skipped`);
      continue;
    }

    const { error } = await admin.auth.admin.updateUserById(authUser.id, {
      password,
    });
    if (error) {
      console.error(`[rotate] failed to set password for ${email}: ${error.message}`);
      continue;
    }

    // Force reset on next login (public.users owns the flag).
    await db
      .update(users)
      .set({ mustResetPassword: true, passwordUpdatedAt: null })
      .where(eq(users.email, email));

    console.log(`[rotate] rotated password + forced reset for ${email}`);
  }

  await client.end();
}

rotate().catch((err) => {
  console.error(err);
  process.exit(1);
});
