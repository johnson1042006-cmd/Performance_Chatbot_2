/**
 * Sync Lightspeed receipt data into product_pairings.
 *
 * Analyzes completed sales over a configurable window to find products that
 * are frequently bought together, then inserts them as `frequently_bought`
 * pairings. Existing manual pairings (matching_jacket, matching_pants,
 * accessory) are never overwritten.
 *
 * Usage:
 *   npx tsx scripts/sync-lightspeed-pairings.ts [--days 90] [--min-count 5] [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { productPairings } from "../lib/db/schema";
import { eq, and, or } from "drizzle-orm";
import {
  getCompletedSales,
  getSaleSkus,
} from "../lib/lightspeed/client";

interface PairCount {
  skuA: string;
  skuB: string;
  count: number;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let days = 90;
  let minCount = 5;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--min-count" && args[i + 1]) {
      minCount = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { days, minCount, dryRun };
}

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function main() {
  const { days, minCount, dryRun } = parseArgs();

  console.log(`Config: last ${days} days, min co-purchase count: ${minCount}, dry-run: ${dryRun}`);

  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - days * 86400000)
    .toISOString()
    .split("T")[0];

  console.log(`Fetching sales from ${startDate} to ${endDate}...`);
  const sales = await getCompletedSales(startDate, endDate);
  console.log(`Fetched ${sales.length} completed sales`);

  const pairCounts = new Map<string, PairCount>();

  for (const sale of sales) {
    const skus = [...new Set(getSaleSkus(sale))];
    if (skus.length < 2) continue;

    for (let i = 0; i < skus.length; i++) {
      for (let j = i + 1; j < skus.length; j++) {
        const [a, b] = normalizePair(skus[i], skus[j]);
        const key = `${a}|${b}`;
        const existing = pairCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          pairCounts.set(key, { skuA: a, skuB: b, count: 1 });
        }
      }
    }
  }

  const qualified = Array.from(pairCounts.values())
    .filter((p) => p.count >= minCount)
    .sort((a, b) => b.count - a.count);

  console.log(
    `Found ${pairCounts.size} unique pairs, ${qualified.length} meet the threshold of ${minCount}`
  );

  if (qualified.length === 0) {
    console.log("No new pairings to insert.");
    return;
  }

  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const existingPairings = await db.select().from(productPairings);
  const existingSet = new Set(
    existingPairings.map((p) => {
      const [a, b] = normalizePair(p.primarySku, p.pairedSku);
      return `${a}|${b}`;
    })
  );

  const newPairings = qualified.filter(
    (p) => !existingSet.has(`${p.skuA}|${p.skuB}`)
  );

  console.log(
    `${qualified.length - newPairings.length} pairs already exist, ${newPairings.length} are new`
  );

  if (dryRun) {
    console.log("\n--- DRY RUN (no DB writes) ---");
    for (const p of newPairings.slice(0, 20)) {
      console.log(`  ${p.skuA} <-> ${p.skuB}  (${p.count} co-purchases)`);
    }
    if (newPairings.length > 20) {
      console.log(`  ... and ${newPairings.length - 20} more`);
    }
    return;
  }

  let inserted = 0;
  for (const p of newPairings) {
    await db.insert(productPairings).values({
      primarySku: p.skuA,
      pairedSku: p.skuB,
      pairingType: "frequently_bought",
    });
    inserted++;
  }

  console.log(
    `\nDone! Inserted ${inserted} new 'frequently_bought' pairings from ${sales.length} receipts.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  });
