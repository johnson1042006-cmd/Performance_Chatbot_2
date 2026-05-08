import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import bcrypt from "bcryptjs";
import { users } from "../lib/db/schema";

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const managerHash = await bcrypt.hash("manager123", 12);
  const agentHash = await bcrypt.hash("agent123", 12);

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
