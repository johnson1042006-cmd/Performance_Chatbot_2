import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as XLSX from "xlsx";
import * as path from "path";
import { localCatalog } from "../lib/db/schema";

async function seedCatalog() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const filePath = path.resolve(__dirname, "../catalog.xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<{ Name: string; Price: number }>(sheet);

  console.log(`Read ${rows.length} products from catalog.xlsx`);

  // Clear existing data
  await db.delete(localCatalog);
  console.log("Cleared existing local_catalog data");

  // Insert in batches of 500
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((row) => ({
      name: row.Name.trim(),
      nameLower: row.Name.trim().toLowerCase(),
      price: row.Price?.toString() ?? null,
    }));

    await db.insert(localCatalog).values(batch);
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${rows.length}`);
  }

  console.log(`Done. ${inserted} products seeded into local_catalog.`);
}

seedCatalog()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
