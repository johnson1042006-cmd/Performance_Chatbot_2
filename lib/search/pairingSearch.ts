import { db } from "@/lib/db";
import { productPairings } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import type { ProductPairing } from "@/lib/db/schema";
import {
  getProductBySKU,
  formatProductForPrompt,
  type BCProduct,
} from "@/lib/bigcommerce/client";

interface PairingResult {
  pairing: ProductPairing;
  product: BCProduct | null;
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

    const product = await getProductBySKU(pairedSku);

    if (product && product.is_visible && product.availability !== "disabled") {
      results.push({ pairing, product });
    }
  }

  return results;
}

export { formatProductForPrompt };
