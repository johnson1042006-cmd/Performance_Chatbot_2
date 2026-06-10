/**
 * Catalog coverage test — verifies the bot can find and present products from
 * every major category in the store.
 *
 * Each entry in CATALOG_QUERIES spawns two independent single-turn tests:
 *   - a clean category query (no brand)
 *   - a brand-scoped query
 *
 * Assertions per test:
 *   1. Products found  — reply contains a markdown link or a price ($).
 *   2. No silent pivot — brand replies must mention the requested brand OR
 *      include an honest acknowledgment phrase.
 *   3. No hallucinated URLs — reply must not contain .../undefined or .../null.
 *
 * Tagged @catalog so it runs independently:
 *   npm run test:catalog
 *   playwright test --grep @catalog
 *
 * Estimated runtime: ~3 min (33 categories × 2 queries × 25 s timeout).
 */

import { test, expect, Page } from "@playwright/test";
import { waitForEmbedReady } from "./helpers";

// ---------------------------------------------------------------------------
// ask() helper — minimal copy (not exported from bot-quality.spec.ts)
// ---------------------------------------------------------------------------

async function ask(page: Page, question: string): Promise<string> {
  const aiSelector = '[data-testid="message-ai"]';
  const beforeCount = await page.locator(aiSelector).count();

  await page.locator('[data-testid="chat-input"]').fill(question);
  await page.locator('[data-testid="chat-send"]').click();

  await page.locator(aiSelector).nth(beforeCount).waitFor({
    state: "visible",
    timeout: 25_000,
  });

  // Let any final streaming settle before reading text.
  await page.waitForTimeout(200);

  return page.locator(aiSelector).nth(beforeCount).innerText();
}

// ---------------------------------------------------------------------------
// Brand lookup table for pivot detection
// ---------------------------------------------------------------------------

const KNOWN_BRANDS = [
  "Shoei",
  "Klim",
  "Arai",
  "Alpinestars",
  "Bell",
  "Sidi",
  "REV'IT",
  "Fox Racing",
  "Troy Lee Designs",
  "Fly Racing",
  "Dunlop",
  "Michelin",
  "FMF",
  "EBC",
  "Motorex",
  "K&N",
  "Cardo",
  "GoPro",
  "Kriega",
  "Pinlock",
];

function extractBrand(brandQuery: string): string | null {
  const q = brandQuery.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    if (q.includes(brand.toLowerCase())) return brand;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function assertProductsFound(reply: string, category: string, query: string) {
  const hasLink = /\[.+\]\(https?:\/\//.test(reply);
  const hasPrice = /\$[\d,]+/.test(reply);
  expect(
    hasLink || hasPrice,
    `${category} — no products found for query: ${query}`
  ).toBe(true);
}

function assertNoPivotWithoutAck(
  reply: string,
  brandQuery: string,
  category: string,
  query: string
) {
  const brand = extractBrand(brandQuery);
  if (!brand) return; // can't check if we don't know the brand
  const r = reply.toLowerCase();
  const brandMentioned = r.includes(brand.toLowerCase());
  const acknowledged = /(not finding|don't have|out of stock|don't see|don't carry)/.test(r);
  expect(
    brandMentioned || acknowledged,
    `${category} — silent brand pivot for query: ${query}`
  ).toBe(true);
}

function assertNoHallucinatedUrls(reply: string, category: string, query: string) {
  expect(
    reply,
    `${category} — hallucinated URL in reply for query: ${query}`
  ).not.toMatch(/performancecycle\.com\/(undefined|null)/);
}

// ---------------------------------------------------------------------------
// Test matrix
// ---------------------------------------------------------------------------

const CATALOG_QUERIES = [
  // HELMETS
  { category: "Street Helmets",     clean: "show me street helmets",                brand: "show me Shoei street helmets" },
  { category: "Adventure Helmets",  clean: "adventure helmets",                     brand: "any Klim adventure helmets" },
  { category: "Race Helmets",       clean: "race helmets",                          brand: "Arai race helmets" },
  { category: "Modular Helmets",    clean: "modular helmets",                       brand: "Shoei modular helmet" },
  { category: "MX Helmets",         clean: "motocross helmets",                     brand: "Alpinestars motocross helmets" },
  { category: "Open Face Helmets",  clean: "open face helmets",                     brand: "Bell open face helmet" },
  // BOOTS
  { category: "MX Boots",           clean: "motocross boots",                       brand: "Alpinestars MX boots" },
  { category: "Adventure Boots",    clean: "adventure boots",                       brand: "Sidi adventure boots" },
  { category: "Race Boots",         clean: "race boots",                            brand: "Alpinestars race boots" },
  { category: "Street Boots",       clean: "street riding boots",                   brand: "REV'IT street boots" },
  // GEAR
  { category: "MX Jerseys",         clean: "motocross jerseys",                     brand: "Fox Racing jerseys" },
  { category: "MX Pants",           clean: "motocross pants",                       brand: "Troy Lee Designs pants" },
  { category: "Street Jackets",     clean: "street riding jacket",                  brand: "Alpinestars street jacket" },
  { category: "Adventure Jackets",  clean: "adventure jacket",                      brand: "Klim adventure jacket" },
  { category: "Gloves",             clean: "riding gloves",                         brand: "Alpinestars gloves" },
  { category: "MX Gloves",          clean: "motocross gloves",                      brand: "Fox Racing MX gloves" },
  // PROTECTION
  { category: "Armor",              clean: "back protector",                        brand: "Alpinestars back protector" },
  { category: "Goggles",            clean: "MX goggles",                            brand: "Fox Racing goggles" },
  { category: "Airbags",            clean: "airbag vest",                           brand: "Alpinestars Tech-Air" },
  // TIRES
  { category: "Sport Tires",        clean: "sportbike tires",                       brand: "Michelin sport tires" },
  { category: "Adventure Tires",    clean: "adventure tires",                       brand: "Dunlop adventure tires" },
  { category: "Offroad Tires",      clean: "offroad tires",                         brand: "Dunlop offroad tires" },
  // PARTS & MAINTENANCE
  { category: "Exhaust",            clean: "exhaust slip-on",                       brand: "FMF exhaust" },
  { category: "Chain",              clean: "motorcycle chain",                      brand: "chain and sprocket kit" },
  { category: "Brake Pads",         clean: "brake pads",                            brand: "EBC brake pads" },
  { category: "Oil",                clean: "motorcycle oil",                        brand: "Motorex oil" },
  { category: "Air Filter",         clean: "air filter",                            brand: "K&N air filter" },
  // ELECTRONICS
  { category: "Communication",      clean: "bluetooth communicator",                brand: "Cardo communicator" },
  { category: "Camera",             clean: "action camera mount",                   brand: "GoPro mount" },
  // ACCESSORIES
  { category: "Luggage",            clean: "motorcycle luggage",                    brand: "Kriega bag" },
  { category: "Helmet Accessories", clean: "helmet visor replacement",              brand: "Pinlock insert" },
  // DEMOGRAPHICS
  { category: "Women's Gear",       clean: "women's riding jacket",                 brand: "REV'IT women's jacket" },
  { category: "Youth Gear",         clean: "youth motocross helmet",                brand: "Fly Racing youth helmet" },
] as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("Catalog coverage @catalog", () => {
  for (const entry of CATALOG_QUERIES) {
    test(`${entry.category} — clean query`, async ({ page }) => {
      test.setTimeout(25_000);

      const sessionId = `catalog-clean-${entry.category.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}`;
      await page.goto(`/embed?sessionId=${sessionId}`);
      await waitForEmbedReady(page);

      const reply = await ask(page, entry.clean);

      assertProductsFound(reply, entry.category, entry.clean);
      assertNoHallucinatedUrls(reply, entry.category, entry.clean);
    });

    test(`${entry.category} — brand-scoped query`, async ({ page }) => {
      test.setTimeout(25_000);

      const sessionId = `catalog-brand-${entry.category.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}`;
      await page.goto(`/embed?sessionId=${sessionId}`);
      await waitForEmbedReady(page);

      const reply = await ask(page, entry.brand);

      assertProductsFound(reply, entry.category, entry.brand);
      assertNoPivotWithoutAck(reply, entry.brand, entry.category, entry.brand);
      assertNoHallucinatedUrls(reply, entry.category, entry.brand);
    });
  }
});
