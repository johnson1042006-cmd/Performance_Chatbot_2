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
// 6543); max: 1 because each serverless function instance holds its own client.
export function createClient(url: string = getDatabaseUrl()) {
  return postgres(url, {
    prepare: false,
    max: 1,
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
