import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as XLSX from "xlsx";
import * as path from "path";
import { localCatalog } from "../lib/db/schema";

interface BCProductMinimal {
  id: number;
  name: string;
  custom_url: { url: string };
}

const BC_BASE = `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3`;
const BC_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;

async function fetchAllBCProducts(): Promise<Map<string, { id: number; url: string }>> {
  const map = new Map<string, { id: number; url: string }>();
  let page = 1;
  const limit = 250;
  let hasMore = true;

  while (hasMore) {
    const url = `${BC_BASE}/catalog/products?limit=${limit}&page=${page}&include_fields=name,custom_url`;
    const res = await fetch(url, {
      headers: {
        "X-Auth-Token": BC_TOKEN,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error(`BC API error page ${page}: ${res.status}`);
      break;
    }

    const json = await res.json();
    const products: BCProductMinimal[] = json.data || [];

    for (const p of products) {
      map.set(p.name.trim().toLowerCase(), {
        id: p.id,
        url: p.custom_url?.url || "",
      });
    }

    console.log(`  Page ${page}: fetched ${products.length} products (total map: ${map.size})`);

    const pagination = json.meta?.pagination;
    hasMore = pagination ? page < pagination.total_pages : products.length === limit;
    page++;
  }

  return map;
}

async function seedCatalog() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const filePath = path.resolve(__dirname, "../catalog.xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<{ Name: string; Price: number }>(sheet);

  console.log(`Read ${rows.length} products from catalog.xlsx`);

  console.log("\nFetching all BigCommerce products for URL mapping...");
  const bcMap = await fetchAllBCProducts();
  console.log(`Mapped ${bcMap.size} BigCommerce products\n`);

  await db.delete(localCatalog);
  console.log("Cleared existing local_catalog data");

  const BATCH_SIZE = 500;
  let inserted = 0;
  let matched = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((row) => {
      const name = row.Name.trim();
      const bcMatch = bcMap.get(name.toLowerCase());
      if (bcMatch) matched++;

      return {
        name,
        nameLower: name.toLowerCase(),
        price: row.Price?.toString() ?? null,
        url: bcMatch?.url || null,
        bcProductId: bcMatch?.id || null,
      };
    });

    await db.insert(localCatalog).values(batch);
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${rows.length}`);
  }

  console.log(`\nDone. ${inserted} products seeded.`);
  console.log(`${matched} of ${inserted} matched to BigCommerce URLs (${((matched / inserted) * 100).toFixed(1)}%)`);
}

seedCatalog()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
