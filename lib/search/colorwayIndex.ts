import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { expandColorQuery } from "./colorSynonyms";

/**
 * Color-driven product retrieval against the product_colorways index.
 *
 * This is the piece the old pipeline lacked entirely: it finds bc_product_ids
 * that come in a requested color BEFORE the candidate pool is built and
 * truncated, so rare-color / broad-category requests ("green jacket") no longer
 * collapse to whatever few color matches happened to survive scoring.
 *
 * Matching runs against the generated `colorway_tsv` (see 0008_colorway_tsv.sql):
 * a 'simple' tsvector over separator-normalized colorway_lower, so single-color
 * queries match compound colorways ("Oil Green", "Black/Green", "Olive/Black").
 * The table is a precomputed INDEX only — live BC variant data remains the
 * source of truth and the caller re-confirms the color before display.
 */

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/**
 * Turn a color into the set of clean single-word tsquery tokens. Expands
 * synonyms, then splits every term on non-alphanumerics (so "steel blue" →
 * steel, blue and "hi-viz" → hi, viz) and drops 1-char noise. Keeping only
 * alphanumeric tokens also means the string is always valid to_tsquery input.
 */
export function colorQueryTokens(color: string): string[] {
  // Guard: expandColorQuery("") matches every color (s.includes("") is always
  // true), which would retrieve the whole catalog. A blank color has no tokens.
  if (!color || !color.trim()) return [];
  const tokens = new Set<string>();
  for (const term of expandColorQuery(color)) {
    for (const tok of term.toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok.length >= 2) tokens.add(tok);
    }
  }
  return Array.from(tokens);
}

export interface ColorwayLookupOptions {
  /** Narrow to products whose name contains one of these type terms (e.g. ["jacket"]). */
  typeTerms?: string[];
  /** Narrow to a brand (matched against the brand column or product name). */
  brand?: string | null;
  /** Max distinct product ids to return. */
  limit?: number;
}

/**
 * Return distinct bc_product_ids that offer a variant in `color`, optionally
 * narrowed by product type and/or brand. Empty array when the color yields no
 * tokens or nothing matches.
 */
export async function findColorwayProductIds(
  color: string,
  opts: ColorwayLookupOptions = {}
): Promise<number[]> {
  const tokens = colorQueryTokens(color);
  if (tokens.length === 0) return [];
  const limit = opts.limit ?? 60;
  const tsquery = tokens.join(" | ");

  const conditions = [
    sql`colorway_tsv @@ to_tsquery('simple', ${tsquery})`,
  ];

  if (opts.typeTerms && opts.typeTerms.length > 0) {
    const typeOr = sql.join(
      opts.typeTerms.map((t) => sql`lower(product_name) LIKE ${"%" + t.toLowerCase() + "%"}`),
      sql` OR `
    );
    conditions.push(sql`(${typeOr})`);
  }

  if (opts.brand) {
    const b = "%" + opts.brand.toLowerCase() + "%";
    conditions.push(
      sql`(lower(coalesce(brand, '')) LIKE ${b} OR lower(product_name) LIKE ${b})`
    );
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const result = await db.execute(sql`
    SELECT DISTINCT bc_product_id
    FROM product_colorways
    WHERE ${whereClause}
    ORDER BY bc_product_id
    LIMIT ${limit}
  `);

  return getRows<{ bc_product_id: number }>(result)
    .map((r) => Number(r.bc_product_id))
    .filter((n) => Number.isFinite(n));
}
