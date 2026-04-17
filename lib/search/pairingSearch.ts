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
    )
    .limit(20);

  const enriched = await Promise.all(
    pairings.map(async (pairing) => {
      const pairedSku =
        pairing.primarySku === sku ? pairing.pairedSku : pairing.primarySku;
      const product = await getProductBySKU(pairedSku).catch(() => null);
      return { pairing, product };
    })
  );

  return enriched.filter(
    (r): r is PairingResult =>
      r.product !== null && r.product.is_visible && r.product.availability !== "disabled"
  );
}

export { formatProductForPrompt };
