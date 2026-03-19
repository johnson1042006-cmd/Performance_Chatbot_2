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

  await db.insert(users).values([
    {
      email: "manager@performancecycle.com",
      passwordHash: managerHash,
      role: "store_manager",
      name: "Store Manager",
    },
    {
      email: "agent@performancecycle.com",
      passwordHash: agentHash,
      role: "support_agent",
      name: "Support Agent",
    },
  ]);

  console.log("Seeded 2 users: manager + agent");
}

seed().catch(console.error);
