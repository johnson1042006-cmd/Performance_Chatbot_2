import { db } from "@/lib/db";
import { productPairings } from "@/lib/db/schema";
import { and, eq, ne, or } from "drizzle-orm";
import type { ProductPairing } from "@/lib/db/schema";
import {
  getProductBySKU,
  getProductById,
  formatProductForPrompt,
  type BCProduct,
} from "@/lib/bigcommerce/client";

interface PairingResult {
  pairing: ProductPairing;
  product: BCProduct | null;
}

async function resolveProduct(sku: string): Promise<BCProduct | null> {
  if (sku.startsWith("ID:")) {
    const id = parseInt(sku.slice(3), 10);
    if (!isNaN(id)) return getProductById(id).catch(() => null);
  }
  return getProductBySKU(sku).catch(() => null);
}

async function normalizeToIdSku(sku: string): Promise<string> {
  if (sku.startsWith("ID:")) return sku;
  const product = await getProductBySKU(sku).catch(() => null);
  if (product?.id) return `ID:${product.id}`;
  return sku;
}

export async function findPairings(sku: string): Promise<PairingResult[]> {
  const lookupKey = await normalizeToIdSku(sku);
  const pairings = await db
    .select()
    .from(productPairings)
    .where(
      and(
        or(
          eq(productPairings.primarySku, lookupKey),
          eq(productPairings.pairedSku, lookupKey)
        ),
        ne(productPairings.pairingType, "frequently_bought")
      )
    )
    .limit(20);

  const enriched = await Promise.all(
    pairings.map(async (pairing) => {
      const pairedSku =
        pairing.primarySku === lookupKey ? pairing.pairedSku : pairing.primarySku;
      const product = await resolveProduct(pairedSku);
      return { pairing, product };
    })
  );

  return enriched.filter(
    (r): r is PairingResult =>
      r.product !== null &&
      r.product.is_visible &&
      r.product.availability !== "disabled"
  );
}

export { formatProductForPrompt };
