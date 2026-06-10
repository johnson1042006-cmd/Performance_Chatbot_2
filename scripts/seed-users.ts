import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
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

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const managerPassword = resolvePassword("SEED_MANAGER_PASSWORD", "manager");
  const agentPassword = resolvePassword("SEED_AGENT_PASSWORD", "agent");

  const managerHash = await bcrypt.hash(managerPassword, 12);
  const agentHash = await bcrypt.hash(agentPassword, 12);

  // upsert by email so re-runs (or already-seeded environments) still flip
  // mustResetPassword=true on the existing rows. This is the security
  // backstop: default credentials must NEVER stay valid past first login.
  await db
    .insert(users)
    .values({
      email: "manager@performancecycle.com",
      passwordHash: managerHash,
      role: "store_manager",
      name: "Store Manager",
      mustResetPassword: true,
      passwordUpdatedAt: null,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        mustResetPassword: true,
      },
    });

  await db
    .insert(users)
    .values({
      email: "agent@performancecycle.com",
      passwordHash: agentHash,
      role: "support_agent",
      name: "Support Agent",
      mustResetPassword: true,
      passwordUpdatedAt: null,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        mustResetPassword: true,
      },
    });

  console.log(
    "Seeded/updated 2 users (manager + agent) with mustResetPassword=true"
  );
}

seed().catch(console.error);
