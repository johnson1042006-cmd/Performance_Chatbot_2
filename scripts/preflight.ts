/**
 * Pre-launch verification script.
 *
 * Run with `npx tsx scripts/preflight.ts` (loads .env.local) or run from
 * a deployed/CI environment where the production env vars are populated.
 *
 * Verifies:
 *   1. All required environment variables are present
 *   2. NEXTAUTH_URL is not pointing at localhost
 *   3. Database is reachable
 *   4. Required seed data exists (users, knowledge, products, pairings)
 *
 * Exits non-zero on failure so it can be wired into CI or a pre-deploy hook.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import {
  users,
  knowledgeBase,
  products,
  productPairings,
} from "../lib/db/schema";

const REQUIRED_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "DATABASE_URL",
  "PUSHER_APP_ID",
  "PUSHER_KEY",
  "PUSHER_SECRET",
  "PUSHER_CLUSTER",
  "NEXT_PUBLIC_PUSHER_KEY",
  "NEXT_PUBLIC_PUSHER_CLUSTER",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "BIGCOMMERCE_STORE_HASH",
  "BIGCOMMERCE_ACCESS_TOKEN",
];

type Result = { ok: boolean; label: string; detail?: string };

function pass(label: string, detail?: string): Result {
  return { ok: true, label, detail };
}

function fail(label: string, detail?: string): Result {
  return { ok: false, label, detail };
}

function checkEnvVars(): Result[] {
  const results: Result[] = [];
  for (const key of REQUIRED_ENV_VARS) {
    const value = process.env[key];
    if (!value) {
      results.push(fail(`env: ${key}`, "missing or empty"));
    } else {
      results.push(pass(`env: ${key}`));
    }
  }

  const url = process.env.NEXTAUTH_URL || "";
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    results.push(
      fail(
        "NEXTAUTH_URL is localhost",
        `value="${url}" — must be the production URL when deploying`
      )
    );
  } else if (url) {
    results.push(pass("NEXTAUTH_URL is non-localhost", url));
  }

  return results;
}

async function checkDatabase(): Promise<Result[]> {
  const results: Result[] = [];
  if (!process.env.DATABASE_URL) {
    results.push(fail("db: connection", "DATABASE_URL not set"));
    return results;
  }

  try {
    const conn = neon(process.env.DATABASE_URL);
    const db = drizzle(conn);

    const userRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    const userCount = userRows[0]?.count ?? 0;
    if (userCount === 0) {
      results.push(
        fail("db: users", "no users — run `npm run db:seed`")
      );
    } else {
      results.push(pass("db: users", `${userCount} row(s)`));
    }

    const kbRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeBase);
    const kbCount = kbRows[0]?.count ?? 0;
    if (kbCount === 0) {
      results.push(
        fail(
          "db: knowledge_base",
          "no knowledge entries — run `npm run db:seed:knowledge`"
        )
      );
    } else {
      results.push(pass("db: knowledge_base", `${kbCount} row(s)`));
    }

    const productRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(products);
    const productCount = productRows[0]?.count ?? 0;
    if (productCount === 0) {
      results.push(
        fail(
          "db: products",
          "no products — run `npm run db:seed:products`"
        )
      );
    } else {
      results.push(pass("db: products", `${productCount} row(s)`));
    }

    const pairingRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(productPairings);
    const pairingCount = pairingRows[0]?.count ?? 0;
    if (pairingCount === 0) {
      results.push(
        fail(
          "db: product_pairings",
          "no pairings — run `npm run db:seed:pairings`"
        )
      );
    } else {
      results.push(pass("db: product_pairings", `${pairingCount} row(s)`));
    }
  } catch (error) {
    results.push(
      fail("db: connection", `error: ${(error as Error).message}`)
    );
  }

  return results;
}

function printResults(title: string, results: Result[]): number {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  let failures = 0;
  for (const r of results) {
    const icon = r.ok ? "PASS" : "FAIL";
    const detail = r.detail ? `  (${r.detail})` : "";
    console.log(`  [${icon}] ${r.label}${detail}`);
    if (!r.ok) failures++;
  }
  return failures;
}

async function main() {
  console.log("Performance Cycle Chat — Preflight Check");
  console.log("=========================================");

  const envResults = checkEnvVars();
  const dbResults = await checkDatabase();

  let failures = 0;
  failures += printResults("Environment variables", envResults);
  failures += printResults("Database & seed data", dbResults);

  console.log("");
  if (failures === 0) {
    console.log("All checks passed.");
    process.exit(0);
  } else {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Preflight crashed:", err);
  process.exit(1);
});
