/**
 * Repair script for sessions contaminated by the tagger's test mode.
 *
 * The Playwright e2e suite sets TAGGER_TEST_MODE=1, which makes the tagger
 * emit a deterministic { topics: ["test-tag"], resolved: false } result. When
 * that suite was pointed at the production database it stamped real sessions
 * with the "test-tag" topic (visible on the Insights topic chart).
 *
 * This script finds every session whose topic_tags contains "test-tag" and
 * re-runs the REAL tagger on it (Claude path) so the row gets a correct
 * intent / topics / resolved value. TAGGER_TEST_MODE is force-cleared here so
 * we never re-apply the test tag.
 *
 * Usage: npm run db:retag-test
 */
import { config } from "dotenv";
config({ path: ".env.local" });

// Make sure the real tagger path runs even if the shell that invoked the
// script still has the e2e flag set.
delete process.env.TAGGER_TEST_MODE;

import { db } from "../lib/db";
import { sql } from "drizzle-orm";
import { tagSession } from "../lib/ai/tagger";

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

async function main() {
  const rowsRaw = await db.execute(sql`
    SELECT id::text AS id
    FROM sessions
    WHERE topic_tags @> '["test-tag"]'::jsonb
    ORDER BY started_at DESC
  `);

  const rows = getRows<{ id: string }>(rowsRaw);
  console.log(`Found ${rows.length} session(s) tagged with "test-tag".`);

  let ok = 0;
  let failed = 0;
  for (const { id } of rows) {
    try {
      const result = await tagSession(id);
      ok += 1;
      console.log(
        `re-tagged ${id} -> intent=${result.intent} resolved=${result.resolved} topics=[${result.topics.join(", ")}]`
      );
    } catch (err) {
      failed += 1;
      console.error(`failed to re-tag ${id}:`, err);
    }
  }

  console.log(`Done. Re-tagged ${ok} session(s), ${failed} failure(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
