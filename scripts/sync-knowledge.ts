import { config } from "dotenv";
config({ path: ".env.local" });
import { createDb } from "../lib/db/connect";
import { knowledgeBase } from "../lib/db/schema";
import { entries } from "../lib/knowledge/seedKnowledge";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const { db, client } = createDb();

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

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
