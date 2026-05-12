/**
 * One-time / on-demand catalog discovery script.
 *
 * Fetches the entire BigCommerce catalog and writes a structured snapshot to
 * tmp/catalog-dump.json. The actual fetch-classify-build logic lives in
 * lib/catalog/dump.ts so it can be reused by the nightly cron handler.
 *
 * Run:
 *   npm run dump:catalog
 *   (requires BIGCOMMERCE_STORE_HASH and BIGCOMMERCE_ACCESS_TOKEN in .env.local)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import * as fs from "fs";
import * as path from "path";

import { dumpCatalog } from "../lib/catalog/dump";

async function main() {
  console.log("dump-catalog — fetching BigCommerce catalog…\n");

  const result = await dumpCatalog();

  const outputDir = path.resolve(__dirname, "../tmp");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, "catalog-dump.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(
    `Wrote ${result.totalProducts} products to tmp/catalog-dump.json`
  );
}

main().catch((err) => {
  console.error("dump-catalog failed:", err);
  process.exit(1);
});
