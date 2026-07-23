import postgres from "postgres";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "Database connection string not configured. Set DATABASE_URL (Supabase transaction pooler URL — see .env.example)."
    );
  }

  return url;
}

// prepare: false is required by Supabase's Supavisor transaction pooler (port
// 6543). max must stay well above 1: locally the whole Next.js server shares
// one client, and Vercel Fluid Compute runs concurrent invocations per
// instance — a single connection serializes every query (measured ~120 ms
// per round trip, which stacked concurrent dashboard loads past 30 s).
export function createClient(url: string = getDatabaseUrl()) {
  return postgres(url, {
    prepare: false,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

// For standalone scripts: exposes the client so callers can `await client.end()`
// when done — postgres.js holds a TCP socket that would otherwise keep tsx alive.
export function createDb(url: string = getDatabaseUrl()): {
  db: Db;
  client: ReturnType<typeof postgres>;
} {
  const client = createClient(url);
  return { db: drizzle(client, { schema }), client };
}
