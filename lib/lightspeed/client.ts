/**
 * Lightspeed Retail (R-Series) API client.
 *
 * Required env vars:
 *   LIGHTSPEED_ACCOUNT_ID  – Your Lightspeed account ID
 *   LIGHTSPEED_API_KEY     – Personal API key (or OAuth access token)
 *
 * Lightspeed R-Series API docs:
 *   https://developers.lightspeedhq.com/retail/introduction/introduction/
 *
 * If using X-Series instead, the base URL and auth differ — swap out the
 * constants below and adjust the response shapes as needed.
 */

const LS_BASE_URL = "https://api.lightspeedapp.com/API/V3";

function getAccountId(): string {
  const id = process.env.LIGHTSPEED_ACCOUNT_ID;
  if (!id) throw new Error("LIGHTSPEED_ACCOUNT_ID is not set");
  return id;
}

function getApiKey(): string {
  const key = process.env.LIGHTSPEED_API_KEY;
  if (!key) throw new Error("LIGHTSPEED_API_KEY is not set");
  return key;
}

interface LSRequestOptions {
  path: string;
  params?: Record<string, string | number>;
}

async function lsFetch<T>(options: LSRequestOptions): Promise<T | null> {
  const accountId = getAccountId();
  const url = new URL(
    `${LS_BASE_URL}/Account/${accountId}${options.path}.json`
  );
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        Accept: "application/json",
      },
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") || "2");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return lsFetch(options);
    }

    if (!res.ok) {
      console.error(
        `Lightspeed API error: ${res.status} ${res.statusText} for ${options.path}`
      );
      return null;
    }

    return (await res.json()) as T;
  } catch (error) {
    console.error("Lightspeed fetch error:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types — Lightspeed R-Series Sale / SaleLine shapes
// ---------------------------------------------------------------------------

export interface LSSaleLine {
  saleLineID: string;
  itemID: string;
  unitQuantity: string;
  unitPrice: string;
  Item?: {
    itemID: string;
    description: string;
    customSku: string;
    systemSku: string;
  };
}

export interface LSSale {
  saleID: string;
  completed: boolean;
  completeTime: string;
  SaleLines?: { SaleLine: LSSaleLine | LSSaleLine[] };
}

interface LSSalesResponse {
  Sale: LSSale | LSSale[];
  "@attributes"?: { count: string; offset: string; limit: string };
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch completed sales within a date range.
 * Lightspeed returns max 100 per page; this handles pagination.
 */
export async function getCompletedSales(
  startDate: string,
  endDate: string
): Promise<LSSale[]> {
  const all: LSSale[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await lsFetch<LSSalesResponse>({
      path: "/Sale",
      params: {
        "completeTime": `><,${startDate},${endDate}`,
        "completed": "true",
        "load_relations": '["SaleLines", "SaleLines.Item"]',
        limit,
        offset,
      },
    });

    if (!data?.Sale) break;

    const sales = Array.isArray(data.Sale) ? data.Sale : [data.Sale];
    all.push(...sales);

    if (sales.length < limit) break;
    offset += limit;
  }

  return all;
}

/**
 * Extract line items (SKUs) from a sale.
 * Lightspeed wraps single-item arrays as plain objects, so we normalize.
 */
export function getSaleSkus(sale: LSSale): string[] {
  if (!sale.SaleLines?.SaleLine) return [];
  const lines = Array.isArray(sale.SaleLines.SaleLine)
    ? sale.SaleLines.SaleLine
    : [sale.SaleLines.SaleLine];

  return lines
    .map((l) => l.Item?.customSku || l.Item?.systemSku || "")
    .filter(Boolean);
}
