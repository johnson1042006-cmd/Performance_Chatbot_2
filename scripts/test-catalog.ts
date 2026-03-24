import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import * as XLSX from "xlsx";
import * as path from "path";

const sql = neon(process.env.DATABASE_URL!);
const BC_BASE = `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3`;
const BC_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;

interface CatalogRow {
  Name: string;
  Price: number;
}

interface BCProduct {
  id: number;
  name: string;
  sku: string;
  price: number;
  is_visible: boolean;
  availability: string;
  custom_url: { url: string } | null;
}

async function bcFetchPage(pageNum: number): Promise<BCProduct[]> {
  const url = new URL(`${BC_BASE}/catalog/products`);
  url.searchParams.set("limit", "250");
  url.searchParams.set("page", String(pageNum));

  const res = await fetch(url.toString(), {
    headers: {
      "X-Auth-Token": BC_TOKEN,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.error(`  BC API error page ${pageNum}: ${res.status} ${res.statusText}`);
    return [];
  }

  const json = await res.json();
  return (json.data as BCProduct[]) || [];
}

async function bcNameLike(name: string): Promise<BCProduct[]> {
  const url = new URL(`${BC_BASE}/catalog/products`);
  url.searchParams.set("name:like", name);
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString(), {
    headers: {
      "X-Auth-Token": BC_TOKEN,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!res.ok) return [];
  const json = await res.json();
  return (json.data as BCProduct[]) || [];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("============================================");
  console.log("  PERFORMANCE CYCLE - FULL CATALOG TEST");
  console.log("============================================\n");

  // ── Step 1: Read catalog.xlsx ──
  const filePath = path.resolve(__dirname, "../catalog.xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const catalogRows = XLSX.utils.sheet_to_json<CatalogRow>(sheet);
  console.log(`[CATALOG] ${catalogRows.length} products in catalog.xlsx\n`);

  // ── Step 2: Read all from local_catalog DB ──
  const dbRows: { name: string; name_lower: string; price: string | null }[] =
    await sql`SELECT name, name_lower, price FROM local_catalog ORDER BY name`;
  console.log(`[DB] ${dbRows.length} products in local_catalog\n`);

  // ── Step 3: DB completeness ──
  console.log("── PHASE 1: Database Completeness ──");
  const dbNameSet = new Set(dbRows.map((r) => r.name_lower));
  const missingFromDB: string[] = [];
  for (const row of catalogRows) {
    if (!dbNameSet.has(row.Name.trim().toLowerCase())) {
      missingFromDB.push(row.Name.trim());
    }
  }
  console.log(`  xlsx count:      ${catalogRows.length}`);
  console.log(`  DB count:        ${dbRows.length}`);
  console.log(`  Missing from DB: ${missingFromDB.length}`);
  if (missingFromDB.length > 0) {
    for (const n of missingFromDB.slice(0, 100)) console.log(`    MISSING: ${n}`);
    if (missingFromDB.length > 100)
      console.log(`    ... and ${missingFromDB.length - 100} more`);
  }
  console.log();

  // ── Step 4: Fetch ALL BigCommerce products (paginated) ──
  console.log("── PHASE 2: Fetching All BigCommerce Products ──");
  const allBC: BCProduct[] = [];
  let page = 1;
  while (true) {
    const products = await bcFetchPage(page);
    if (products.length === 0) break;
    allBC.push(...products);
    console.log(`  Page ${page}: +${products.length} (total: ${allBC.length})`);
    page++;
    await sleep(250);
  }
  console.log(`  Total BC products fetched: ${allBC.length}\n`);

  // ── Step 5: Build BC lookup ──
  const bcByNameLower = new Map<string, BCProduct>();
  for (const p of allBC) {
    bcByNameLower.set(p.name.toLowerCase().trim(), p);
  }

  // ── Step 6: Cross-reference catalog vs BC ──
  console.log("── PHASE 3: Catalog vs BigCommerce (exact name match) ──");
  let exactVisible = 0;
  let exactVisibleHasUrl = 0;
  let exactVisibleNoUrl = 0;
  let exactInvisible = 0;
  let noExactMatch = 0;

  const noMatchNames: string[] = [];
  const invisibleNames: string[] = [];
  const emptyUrlNames: string[] = [];

  for (const row of catalogRows) {
    const name = row.Name.trim();
    const bc = bcByNameLower.get(name.toLowerCase());

    if (!bc) {
      noExactMatch++;
      noMatchNames.push(name);
    } else if (!bc.is_visible) {
      exactInvisible++;
      invisibleNames.push(`${name} [BC#${bc.id}]`);
    } else if (!bc.custom_url?.url) {
      exactVisibleNoUrl++;
      emptyUrlNames.push(`${name} [BC#${bc.id}]`);
    } else {
      exactVisible++;
      exactVisibleHasUrl++;
    }
  }

  console.log(`  Visible + has URL:  ${exactVisibleHasUrl}`);
  console.log(`  Visible + NO URL:   ${exactVisibleNoUrl}`);
  console.log(`  Invisible/hidden:   ${exactInvisible}`);
  console.log(`  No exact match:     ${noExactMatch}`);
  console.log();

  // ── Step 7: Fuzzy match (name:like) for products that had no exact match ──
  console.log("── PHASE 4: Fuzzy Match (name:like) for Non-Matches ──");
  const fuzzyTestCount = Math.min(noMatchNames.length, noMatchNames.length);
  let fuzzyFound = 0;
  let fuzzyNotFound = 0;
  let fuzzyFoundNoUrl = 0;
  const fuzzyDetails: {
    catalogName: string;
    bcName: string | null;
    url: string | null;
    visible: boolean;
  }[] = [];

  for (let i = 0; i < fuzzyTestCount; i++) {
    const name = noMatchNames[i];
    const searchName = name.length > 60 ? name.substring(0, 60) : name;

    try {
      const results = await bcNameLike(searchName);
      if (results.length > 0) {
        const best = results[0];
        fuzzyFound++;
        if (!best.custom_url?.url) fuzzyFoundNoUrl++;
        fuzzyDetails.push({
          catalogName: name,
          bcName: best.name,
          url: best.custom_url?.url || null,
          visible: best.is_visible,
        });
      } else {
        fuzzyNotFound++;
        fuzzyDetails.push({
          catalogName: name,
          bcName: null,
          url: null,
          visible: false,
        });
      }
    } catch {
      fuzzyNotFound++;
      fuzzyDetails.push({
        catalogName: name,
        bcName: null,
        url: null,
        visible: false,
      });
    }

    if ((i + 1) % 10 === 0) {
      await sleep(600);
    }
    if ((i + 1) % 25 === 0) {
      console.log(`  Tested ${i + 1}/${fuzzyTestCount}...`);
    }
  }

  console.log(`  Fuzzy found:        ${fuzzyFound}/${fuzzyTestCount}`);
  console.log(`  Fuzzy NOT found:    ${fuzzyNotFound}/${fuzzyTestCount}`);
  console.log(`  Fuzzy found no URL: ${fuzzyFoundNoUrl}`);
  console.log();

  // ── Detailed output ──
  if (fuzzyDetails.length > 0) {
    console.log("── DETAIL: Fuzzy Match Results ──");
    for (const d of fuzzyDetails) {
      if (d.bcName) {
        const urlStatus = d.url ? d.url : "NO URL";
        const visStatus = d.visible ? "" : " [HIDDEN]";
        console.log(`  FUZZY OK: "${d.catalogName}" -> "${d.bcName}" (${urlStatus})${visStatus}`);
      } else {
        console.log(`  NOT FOUND: "${d.catalogName}"`);
      }
    }
    console.log();
  }

  if (invisibleNames.length > 0) {
    console.log("── DETAIL: Invisible/Hidden Products ──");
    for (const n of invisibleNames) console.log(`  HIDDEN: ${n}`);
    console.log();
  }

  if (emptyUrlNames.length > 0) {
    console.log("── DETAIL: Products With Empty URL ──");
    for (const n of emptyUrlNames) console.log(`  NO URL: ${n}`);
    console.log();
  }

  if (missingFromDB.length > 0) {
    console.log("── DETAIL: Products Missing From Local DB ──");
    for (const n of missingFromDB) console.log(`  DB MISS: ${n}`);
    console.log();
  }

  // ── URL format check on all matched products ──
  console.log("── PHASE 5: URL Format Validation ──");
  let goodUrls = 0;
  let badUrls = 0;
  const badUrlExamples: string[] = [];

  for (const row of catalogRows) {
    const name = row.Name.trim();
    const bc = bcByNameLower.get(name.toLowerCase());
    if (!bc || !bc.is_visible) continue;

    const urlPath = bc.custom_url?.url;
    if (!urlPath || urlPath.trim() === "" || urlPath === "/") {
      badUrls++;
      badUrlExamples.push(`${name}: URL="${urlPath || "(empty)"}"`);
    } else if (!urlPath.startsWith("/")) {
      badUrls++;
      badUrlExamples.push(`${name}: URL="${urlPath}" (no leading slash)`);
    } else {
      goodUrls++;
    }
  }

  console.log(`  Valid URLs:   ${goodUrls}`);
  console.log(`  Invalid URLs: ${badUrls}`);
  if (badUrlExamples.length > 0) {
    for (const ex of badUrlExamples) console.log(`    BAD URL: ${ex}`);
  }
  console.log();

  // ── Final summary ──
  const totalFindable = exactVisibleHasUrl + fuzzyFound - fuzzyFoundNoUrl;
  const totalUnfindable = fuzzyNotFound + exactInvisible + exactVisibleNoUrl + fuzzyFoundNoUrl;

  console.log("============================================");
  console.log("  FINAL SUMMARY");
  console.log("============================================");
  console.log(`  Catalog products:             ${catalogRows.length}`);
  console.log(`  DB completeness:              ${dbRows.length}/${catalogRows.length} (missing: ${missingFromDB.length})`);
  console.log(`  BC exact match (visible+URL): ${exactVisibleHasUrl}`);
  console.log(`  BC exact match (invisible):   ${exactInvisible}`);
  console.log(`  BC exact match (no URL):      ${exactVisibleNoUrl}`);
  console.log(`  BC no exact match:            ${noExactMatch}`);
  console.log(`  Fuzzy recovery:               ${fuzzyFound}/${fuzzyTestCount}`);
  console.log(`  Truly unfindable:             ${fuzzyNotFound}`);
  console.log(`  URL validation pass:          ${goodUrls}`);
  console.log(`  URL validation fail:          ${badUrls}`);
  console.log("============================================");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
