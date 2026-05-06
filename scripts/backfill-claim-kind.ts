/**
 * One-time backfill: set claimed_by_kind from existing status values
 * and initialize last_customer_activity_at for rows that have it null.
 *
 * Run once after deploying the schema change:
 *   npx tsx scripts/backfill-claim-kind.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

async function main() {
  console.log("Backfilling claimed_by_kind from existing status values...");

  // active_human rows → claimed_by_kind = 'human'
  const humanResult = await db
    .update(schema.sessions)
    .set({ claimedByKind: "human" })
    .where(
      sql`${schema.sessions.status} = 'active_human' AND ${schema.sessions.claimedByKind} IS NULL`
    )
    .returning({ id: schema.sessions.id });
  console.log(`  Set claimed_by_kind='human' on ${humanResult.length} rows`);

  // active_ai rows → claimed_by_kind = 'ai'
  const aiResult = await db
    .update(schema.sessions)
    .set({ claimedByKind: "ai" })
    .where(
      sql`${schema.sessions.status} = 'active_ai' AND ${schema.sessions.claimedByKind} IS NULL`
    )
    .returning({ id: schema.sessions.id });
  console.log(`  Set claimed_by_kind='ai' on ${aiResult.length} rows`);

  // Ensure last_customer_activity_at is not null (use started_at as fallback)
  const activityResult = await db
    .update(schema.sessions)
    .set({ lastCustomerActivityAt: schema.sessions.startedAt })
    .where(isNull(schema.sessions.lastCustomerActivityAt))
    .returning({ id: schema.sessions.id });
  console.log(`  Initialized last_customer_activity_at on ${activityResult.length} rows`);

  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
