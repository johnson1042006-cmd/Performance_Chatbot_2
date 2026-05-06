import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { knowledgeBase } from "../lib/db/schema";
import { entries } from "../lib/knowledge/seedKnowledge";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);

  for (const entry of entries) {
    await db
      .insert(knowledgeBase)
      .values(entry)
      .onConflictDoUpdate({
        target: knowledgeBase.topic,
        set: { content: entry.content, updatedAt: new Date() },
      });
    console.log(`Synced: ${entry.topic}`);
  }

  console.log(`\nDone. Synced ${entries.length} entries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
