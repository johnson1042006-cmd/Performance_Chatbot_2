import { db } from "@/lib/db";
import { products, productPairings } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import type { Product, ProductPairing } from "@/lib/db/schema";

interface PairingResult {
  pairing: ProductPairing;
  product: Product | null;
}

export async function findPairings(sku: string): Promise<PairingResult[]> {
  const pairings = await db
    .select()
    .from(productPairings)
    .where(
      or(
        eq(productPairings.primarySku, sku),
        eq(productPairings.pairedSku, sku)
      )
    );

  const results: PairingResult[] = [];

  for (const pairing of pairings) {
    const pairedSku =
      pairing.primarySku === sku ? pairing.pairedSku : pairing.primarySku;

    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.sku, pairedSku))
      .limit(1);

    if (product && !product.isDiscontinued) {
      results.push({ pairing, product });
    }
  }

  return results;
}
