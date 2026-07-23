/**
 * Reads tmp/catalog-dump.json, builds the CatalogSkeleton, formats it, and
 * upserts the result into the knowledge_base table as topic "store_catalog_index".
 *
 * Run after dump:catalog whenever the catalog has been refreshed:
 *   npm run catalog:refresh
 *
 * Requires DATABASE_URL in .env.local.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import * as fs from "fs";
import * as path from "path";

import { createDb } from "../lib/db/connect";
import { knowledgeBase } from "../lib/db/schema";
import {
  buildSkeletonFromDump,
  formatSkeletonForPrompt,
} from "../lib/catalog/skeleton";

const TOPIC = "store_catalog_index";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required — add it to .env.local");
  }

  // -------------------------------------------------------------------------
  // Read dump
  // -------------------------------------------------------------------------

  const dumpPath = path.resolve(__dirname, "../tmp/catalog-dump.json");
  if (!fs.existsSync(dumpPath)) {
    throw new Error(
      `tmp/catalog-dump.json not found. Run "npm run dump:catalog" first.`
    );
  }

  const raw = fs.readFileSync(dumpPath, "utf-8");
  const dumpJson = JSON.parse(raw);

  console.log(
    `refresh-catalog-skeleton — dump dated ${dumpJson.generatedAt}, ` +
      `${dumpJson.totalProducts ?? "?"} products\n`
  );

  // -------------------------------------------------------------------------
  // Build + format
  // -------------------------------------------------------------------------

  const skeleton = buildSkeletonFromDump(dumpJson);
  const content = formatSkeletonForPrompt(skeleton);

  const charCount = content.length;
  const tokenApprox = Math.ceil(charCount / 4);

  console.log(`  Skeleton built:`);
  console.log(`    Types: ${Object.keys(skeleton.byType).join(", ")}`);
  console.log(`    Characters: ${charCount.toLocaleString()}`);
  console.log(`    ~Tokens (÷4): ${tokenApprox.toLocaleString()}`);

  // -------------------------------------------------------------------------
  // Upsert into knowledge_base
  // -------------------------------------------------------------------------

  const { db, client } = createDb();

  await db
    .insert(knowledgeBase)
    .values({
      topic: TOPIC,
      content,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: knowledgeBase.topic,
      set: { content, updatedAt: new Date() },
    });

  console.log(`\nUpserted knowledge_base row: topic="${TOPIC}"`);
  console.log("Done.");

  await client.end();
}

main().catch((err) => {
  console.error("refresh-catalog-skeleton failed:", err);
  process.exit(1);
});
