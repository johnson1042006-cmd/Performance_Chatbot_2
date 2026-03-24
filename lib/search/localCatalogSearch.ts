import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface LocalMatch {
  name: string;
  price: string | null;
  url: string | null;
  score: number;
}

interface Row {
  name: string;
  price: string | null;
  url: string | null;
}

interface RowRank extends Row {
  rank: number;
}

interface RowSim extends Row {
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
 * Multi-strategy local search across the full product catalog.
 *
 * Strategy order:
 *   1. ILIKE exact substring (highest confidence)
 *   2. Per-word ILIKE (most reliable for multi-word queries)
 *   3. Full-text search via tsvector/plainto_tsquery
 *   4. Trigram similarity (fuzzy)
 */
export async function searchLocalCatalog(
  query: string,
  limit = 15
): Promise<LocalMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];

  const seen = new Map<string, LocalMatch>();

  function add(name: string, price: string | null, url: string | null, score: number) {
    const key = name.toLowerCase();
    const existing = seen.get(key);
    if (!existing || existing.score < score) {
      seen.set(key, { name, price, url, score });
    }
  }

  // 1. ILIKE substring — catches exact product name fragments
  try {
    const ilikeRaw = await db.execute(
      sql`SELECT name, price, url FROM local_catalog WHERE name_lower LIKE ${`%${q}%`} LIMIT 20`
    );
    for (const r of getRows<Row>(ilikeRaw)) {
      add(r.name, r.price, r.url, 1.0);
    }
  } catch (e) {
    console.error("ILIKE search failed:", e);
  }

  // 2. Per-word ILIKE — search each keyword independently, then boost multi-matches.
  //    Longest words searched first (more distinctive = fewer false positives).
  try {
    const words = q
      .replace(/[?!.,;:'"()]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .sort((a, b) => b.length - a.length);

    const wordHits = new Map<string, number>();

    for (const word of words) {
      const wordRaw = await db.execute(
        sql`SELECT name, price, url FROM local_catalog WHERE name_lower LIKE ${`%${word}%`} LIMIT 20`
      );
      for (const r of getRows<Row>(wordRaw)) {
        const key = r.name.toLowerCase();
        wordHits.set(key, (wordHits.get(key) || 0) + 1);
        add(r.name, r.price, r.url, 0.3);
      }
    }

    // Boost products that matched multiple keywords
    for (const [key, hitCount] of wordHits) {
      if (hitCount > 1) {
        const existing = seen.get(key);
        if (existing && existing.score < 1.0) {
          const boosted = Math.min(0.3 + hitCount * 0.25, 0.95);
          if (boosted > existing.score) {
            seen.set(key, { ...existing, score: boosted });
          }
        }
      }
    }
  } catch (e) {
    console.error("Per-word ILIKE search failed:", e);
  }

  // 3. Full-text search (handles stemming: "ramps" → "ramp")
  try {
    const ftsRaw = await db.execute(
      sql`SELECT name, price, url, ts_rank(to_tsvector('english', name_lower), plainto_tsquery('english', ${q})) as rank
          FROM local_catalog
          WHERE to_tsvector('english', name_lower) @@ plainto_tsquery('english', ${q})
          ORDER BY rank DESC
          LIMIT 20`
    );
    for (const r of getRows<RowRank>(ftsRaw)) {
      add(r.name, r.price, r.url, 0.8 + Math.min(Number(r.rank), 0.2));
    }
  } catch (e) {
    console.error("FTS search failed:", e);
  }

  // 4. Trigram similarity (fuzzy — catches typos and partial matches)
  try {
    const trigramRaw = await db.execute(
      sql`SELECT name, price, url, similarity(name_lower, ${q}) as sim
          FROM local_catalog
          WHERE similarity(name_lower, ${q}) > 0.08
          ORDER BY sim DESC
          LIMIT 20`
    );
    for (const r of getRows<RowSim>(trigramRaw)) {
      add(r.name, r.price, r.url, Number(r.sim));
    }
  } catch (e) {
    console.error("Trigram search failed:", e);
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
