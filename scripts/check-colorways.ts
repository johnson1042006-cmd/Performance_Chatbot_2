import { db } from "@/lib/db";
import { productColorways, products } from "@/lib/db/schema";
import { sql, eq, ilike } from "drizzle-orm";

async function main() {
  console.log("=== productColorways diagnostic ===\n");

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productColorways);
  console.log(`Total rows in productColorways: ${count}`);

  if (count === 0) {
    console.log("\nTable is EMPTY. Fix: run `npm run db:seed:colorways`.");
    process.exit(0);
  }

  const sample = await db.select().from(productColorways).limit(5);
  console.log("\nSample rows:");
  console.dir(sample, { depth: null });

  const colors = await db
    .select({
      color: productColorways.colorwayLower,
      n: sql<number>`count(*)::int`,
    })
    .from(productColorways)
    .groupBy(productColorways.colorwayLower)
    .orderBy(sql`count(*) desc`)
    .limit(20);
  console.log("\nTop 20 distinct colors (lowercased):");
  console.table(colors);

  for (const target of ["blue", "green", "red"]) {
    const matches = await db
      .select({
        bcProductId: productColorways.bcProductId,
        colorway: productColorways.colorway,
        productName: products.name,
        category: products.category,
      })
      .from(productColorways)
      .innerJoin(products, eq(products.bcProductId, productColorways.bcProductId))
      .where(ilike(productColorways.colorway, `%${target}%`))
      .limit(5);
    console.log(`\n"${target}" matches via ilike: ${matches.length}`);
    if (matches.length) console.dir(matches, { depth: null });
  }

  for (const target of ["blue", "green", "red"]) {
    const helmets = await db
      .select({
        productName: products.name,
        colorway: productColorways.colorway,
      })
      .from(productColorways)
      .innerJoin(products, eq(products.bcProductId, productColorways.bcProductId))
      .where(
        sql`${productColorways.colorwayLower} like ${"%" + target + "%"}
            and lower(${products.category}) like '%helmet%'`
      )
      .limit(5);
    console.log(`\n"${target} helmets" matches: ${helmets.length}`);
    if (helmets.length) console.dir(helmets, { depth: null });
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
