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

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function destem(word: string): string {
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * Multi-strategy local search. Strategies run in order of reliability
 * and the function returns early when enough good results are found.
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

  function results() {
    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const words = q
    .replace(/[?!.,;:'"()]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  // Strategy 1: FTS (handles stemming — "ramps" matches "ramp", most reliable)
  try {
    const ftsRaw = await db.execute(
      sql`SELECT name, price, url, ts_rank(to_tsvector('english', name_lower), plainto_tsquery('english', ${q})) as rank
          FROM local_catalog
          WHERE to_tsvector('english', name_lower) @@ plainto_tsquery('english', ${q})
          ORDER BY rank DESC
          LIMIT 20`
    );
    for (const r of getRows<RowRank>(ftsRaw)) {
      add(r.name, r.price, r.url, 0.9 + Math.min(Number(r.rank), 0.1));
    }
  } catch (e) {
    console.error("FTS search failed:", e);
  }

  // If FTS found good results, return early (saves DB round-trips)
  if (seen.size >= 3) return results();

  // Strategy 2: Multi-word AND with basic de-stemming
  if (words.length >= 2) {
    try {
      const stemmedWords = words.map((w) => destem(w));
      const likeConditions = stemmedWords.map((w) => sql`name_lower LIKE ${`%${w}%`}`);
      const combined = likeConditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
      const andRaw = await db.execute(
        sql`SELECT name, price, url FROM local_catalog WHERE ${combined} LIMIT 20`
      );
      for (const r of getRows<Row>(andRaw)) {
        add(r.name, r.price, r.url, 1.0);
      }
    } catch (e) {
      console.error("Multi-word AND search failed:", e);
    }
  }

  if (seen.size >= 3) return results();

  // Strategy 3: ILIKE full substring
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

  if (seen.size >= 3) return results();

  // Strategy 4: Per-word ILIKE (longest words first, with multi-match boost)
  try {
    const sortedWords = [...words]
      .filter((w) => w.length > 2)
      .sort((a, b) => b.length - a.length);
    const wordHits = new Map<string, number>();

    for (const word of sortedWords) {
      const stemmed = destem(word);
      const wordRaw = await db.execute(
        sql`SELECT name, price, url FROM local_catalog WHERE name_lower LIKE ${`%${stemmed}%`} LIMIT 20`
      );
      for (const r of getRows<Row>(wordRaw)) {
        const key = r.name.toLowerCase();
        wordHits.set(key, (wordHits.get(key) || 0) + 1);
        add(r.name, r.price, r.url, 0.3);
      }
    }

    for (const [key, hitCount] of Array.from(wordHits.entries())) {
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

  return results();
}
