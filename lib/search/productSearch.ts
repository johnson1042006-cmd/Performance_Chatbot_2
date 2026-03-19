import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq, ilike, or, sql } from "drizzle-orm";
import Fuse from "fuse.js";
import { expandColorQuery } from "./colorSynonyms";
import type { Product } from "@/lib/db/schema";

export async function searchProducts(query: string): Promise<Product[]> {
  if (!query || query.trim().length === 0) return [];

  const normalizedQuery = query.trim();

  const skuResults = await db
    .select()
    .from(products)
    .where(
      eq(products.isDiscontinued, false)
    )
    .then((rows) =>
      rows.filter(
        (p) =>
          p.sku.toLowerCase() === normalizedQuery.toLowerCase() ||
          p.sku.toLowerCase().startsWith(normalizedQuery.toLowerCase())
      )
    );

  if (skuResults.length > 0) return skuResults;

  const colorTerms = expandColorQuery(normalizedQuery);
  const hasColorMatch = colorTerms.length > 1;

  const conditions = [
    ilike(products.name, `%${normalizedQuery}%`),
    ilike(products.description, `%${normalizedQuery}%`),
  ];

  if (hasColorMatch) {
    for (const color of colorTerms) {
      conditions.push(sql`${color} = ANY(${products.colorTags})`);
    }
  }

  const dbResults = await db
    .select()
    .from(products)
    .where(
      or(
        ...conditions
      )!
    );

  const activeResults = dbResults.filter((p) => !p.isDiscontinued);

  if (activeResults.length >= 3) return activeResults;

  const allActive = await db
    .select()
    .from(products)
    .where(eq(products.isDiscontinued, false));

  const fuse = new Fuse(allActive, {
    keys: [
      { name: "name", weight: 0.4 },
      { name: "description", weight: 0.3 },
      { name: "sku", weight: 0.2 },
      { name: "category", weight: 0.1 },
    ],
    threshold: 0.4,
    includeScore: true,
  });

  const fuseResults = fuse.search(normalizedQuery);

  const combined = new Map<string, Product>();
  for (const p of activeResults) combined.set(p.id, p);
  for (const fr of fuseResults) {
    if (!combined.has(fr.item.id)) combined.set(fr.item.id, fr.item);
  }

  return Array.from(combined.values());
}
