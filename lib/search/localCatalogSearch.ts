import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface LocalMatch {
  name: string;
  price: string | null;
  score: number;
}

interface NamePrice {
  name: string;
  price: string | null;
}

interface NamePriceRank extends NamePrice {
  rank: number;
}

interface NamePriceSim extends NamePrice {
  sim: number;
}

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/**
 * Multi-strategy local search across the full 5,622-product catalog.
 *
 * Strategy order:
 *   1. ILIKE exact substring (highest confidence)
 *   2. Full-text search via tsvector/plainto_tsquery
 *   3. Trigram similarity (fuzzy)
 *   4. Per-word ILIKE fallback (for multi-word queries where AND doesn't match)
 */
export async function searchLocalCatalog(
  query: string,
  limit = 15
): Promise<LocalMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];

  const seen = new Map<string, LocalMatch>();

  function add(name: string, price: string | null, score: number) {
    const key = name.toLowerCase();
    const existing = seen.get(key);
    if (!existing || existing.score < score) {
      seen.set(key, { name, price, score });
    }
  }

  // 1. ILIKE substring — catches exact product name fragments
  try {
    const ilikeRaw = await db.execute(
      sql`SELECT name, price FROM local_catalog WHERE name_lower LIKE ${`%${q}%`} LIMIT 20`
    );
    for (const r of getRows<NamePrice>(ilikeRaw)) {
      add(r.name, r.price, 1.0);
    }
  } catch (e) {
    console.error("ILIKE search failed:", e);
  }

  // 2. Per-word ILIKE — search each keyword independently (most reliable strategy)
  try {
    const words = q
      .replace(/[?!.,;:'"()]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    for (const word of words) {
      if (seen.size >= limit) break;
      const wordRaw = await db.execute(
        sql`SELECT name, price FROM local_catalog WHERE name_lower LIKE ${`%${word}%`} LIMIT 15`
      );
      for (const r of getRows<NamePrice>(wordRaw)) {
        add(r.name, r.price, 0.5);
      }
    }
  } catch (e) {
    console.error("Per-word ILIKE search failed:", e);
  }

  // 3. Full-text search (handles stemming: "ramps" → "ramp")
  try {
    const ftsRaw = await db.execute(
      sql`SELECT name, price, ts_rank(to_tsvector('english', name_lower), plainto_tsquery('english', ${q})) as rank
          FROM local_catalog
          WHERE to_tsvector('english', name_lower) @@ plainto_tsquery('english', ${q})
          ORDER BY rank DESC
          LIMIT 20`
    );
    for (const r of getRows<NamePriceRank>(ftsRaw)) {
      add(r.name, r.price, 0.8 + Math.min(Number(r.rank), 0.2));
    }
  } catch (e) {
    console.error("FTS search failed:", e);
  }

  // 4. Trigram similarity (fuzzy — catches typos and partial matches)
  try {
    const trigramRaw = await db.execute(
      sql`SELECT name, price, similarity(name_lower, ${q}) as sim
          FROM local_catalog
          WHERE similarity(name_lower, ${q}) > 0.08
          ORDER BY sim DESC
          LIMIT 20`
    );
    for (const r of getRows<NamePriceSim>(trigramRaw)) {
      add(r.name, r.price, Number(r.sim));
    }
  } catch (e) {
    console.error("Trigram search failed:", e);
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
