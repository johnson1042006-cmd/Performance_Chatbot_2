import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { users } from "../lib/db/schema";

// One-off rotation for the two seeded accounts. Sets fresh bcrypt hashes from
// env vars and forces a password reset on next login. Run after any concern
// that the old seeded credentials may have been exposed.
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
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const managerPassword = requirePassword("SEED_MANAGER_PASSWORD");
  const agentPassword = requirePassword("SEED_AGENT_PASSWORD");

  const updates: { email: string; password: string }[] = [
    { email: "manager@performancecycle.com", password: managerPassword },
    { email: "agent@performancecycle.com", password: agentPassword },
  ];

  for (const { email, password } of updates) {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db
      .update(users)
      .set({ passwordHash, mustResetPassword: true, passwordUpdatedAt: null })
      .where(eq(users.email, email))
      .returning({ id: users.id, email: users.email });
    if (result.length === 0) {
      console.warn(`[rotate] no user found for ${email} — skipped`);
    } else {
      console.log(`[rotate] rotated password + forced reset for ${email}`);
    }
  }
}

rotate().catch((err) => {
  console.error(err);
  process.exit(1);
});
