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

  // 1. ILIKE substring — catches exact product name fragments like "yagyo"
  const ilikeRaw = await db.execute(
    sql`SELECT name, price FROM local_catalog WHERE name_lower LIKE ${`%${q}%`} LIMIT 20`
  );
  const ilikeRows = getRows<NamePrice>(ilikeRaw);
  for (const r of ilikeRows) {
    add(r.name, r.price, 1.0);
  }

  // 2. Full-text search (handles stemming: "folding" → "fold")
  const ftsRaw = await db.execute(
    sql`SELECT name, price, ts_rank(to_tsvector('english', name_lower), plainto_tsquery('english', ${q})) as rank
        FROM local_catalog
        WHERE to_tsvector('english', name_lower) @@ plainto_tsquery('english', ${q})
        ORDER BY rank DESC
        LIMIT 20`
  );
  const ftsRows = getRows<NamePriceRank>(ftsRaw);
  for (const r of ftsRows) {
    add(r.name, r.price, 0.8 + Math.min(Number(r.rank), 0.2));
  }

  // 3. Trigram similarity (fuzzy — catches typos and partial matches)
  const trigramRaw = await db.execute(
    sql`SELECT name, price, similarity(name_lower, ${q}) as sim
        FROM local_catalog
        WHERE similarity(name_lower, ${q}) > 0.08
        ORDER BY sim DESC
        LIMIT 20`
  );
  const trigramRows = getRows<NamePriceSim>(trigramRaw);
  for (const r of trigramRows) {
    add(r.name, r.price, Number(r.sim));
  }

  // 4. Per-word ILIKE fallback — if the full query is multi-word and
  //    returned few results, search each significant word individually.
  if (seen.size < 5) {
    const words = q
      .replace(/[?!.,;:'"()]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const stopWords = new Set([
      "the", "and", "for", "are", "you", "have", "with", "this", "that",
      "from", "your", "can", "does", "what", "any", "how", "our",
    ]);

    const significantWords = words.filter((w) => !stopWords.has(w));

    for (const word of significantWords) {
      if (seen.size >= limit) break;
      const wordRaw = await db.execute(
        sql`SELECT name, price FROM local_catalog WHERE name_lower LIKE ${`%${word}%`} LIMIT 10`
      );
      for (const r of getRows<NamePrice>(wordRaw)) {
        add(r.name, r.price, 0.3);
      }
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
