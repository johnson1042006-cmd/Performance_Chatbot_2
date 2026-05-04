import { NextResponse } from "next/server";
import { getProductById } from "@/lib/bigcommerce/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const testId = 6010; // Shoei RF-SR Fullface Helmet (known blue helmet)

  let result: unknown = null;
  let error: string | null = null;

  try {
    const product = await getProductById(testId);
    result = product
      ? {
          name: product.name,
          id: product.id,
          is_visible: product.is_visible,
          variantCount: product.variants?.length ?? 0,
          firstVariantLabel: product.variants?.[0]?.option_values?.[0]?.label ?? "none",
        }
      : "returned null";
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    testId,
    result,
    error,
    env: {
      hasStoreHash: !!process.env.BIGCOMMERCE_STORE_HASH,
      hasAccessToken: !!process.env.BIGCOMMERCE_ACCESS_TOKEN,
    },
  });
}
