import { neon } from "@neondatabase/serverless";
import { drizzle, NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDatabaseUrl(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL_NON_POOLED ||
    process.env.DATABASE_URL_UNPOOLED;

  if (!url) {
    throw new Error(
      "Database connection string not configured. Set DATABASE_URL (recommended) or provide POSTGRES_URL(_NON_POOLING) via the Vercel Neon integration."
    );
  }

  return url;
}

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    const sql = neon(getDatabaseUrl(), { fetchOptions: { cache: "no-store" } });
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop: string) {
    const instance = getDb();
    return instance[prop as keyof typeof instance];
  },
});
