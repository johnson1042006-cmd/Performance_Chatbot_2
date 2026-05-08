/**
 * Playwright globalSetup: runs once before any test in the suite.
 *
 * Phase 1 added a `mustResetPassword=true` flag on the seeded manager and
 * agent users — the production-correct behavior is to force a password
 * change on first login. The seed script faithfully sets that flag on every
 * `npm run db:seed`, which means the e2e smoke suite (which logs the same
 * test users in many times with their default passwords) would always be
 * redirected to /password-reset and never reach /dashboard.
 *
 * This setup flips the flag back to `false` for the two known test
 * accounts ONCE per suite run. It does not change passwords, does not
 * touch any other user, and runs entirely against the same DATABASE_URL
 * the dev server reads from .env.local — so production seeds remain
 * security-correct (default credentials still expire on first login),
 * but the e2e suite gets a clean slate every time it starts.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inArray } from "drizzle-orm";
import { users } from "../lib/db/schema";

const MANAGER_EMAIL =
  process.env.E2E_MANAGER_EMAIL || "manager@performancecycle.com";
const AGENT_EMAIL =
  process.env.E2E_AGENT_EMAIL || "agent@performancecycle.com";

export default async function globalSetup() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[e2e/global-setup] DATABASE_URL not set — skipping mustResetPassword clear",
    );
    return;
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);

  const result = await db
    .update(users)
    .set({ mustResetPassword: false })
    .where(inArray(users.email, [MANAGER_EMAIL, AGENT_EMAIL]))
    .returning({ id: users.id, email: users.email });

  console.log(
    `[e2e/global-setup] cleared mustResetPassword on ${result.length} test user(s): ${result.map((r) => r.email).join(", ")}`,
  );
}
