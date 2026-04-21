/**
 * scripts/audit-bot-links.ts
 *
 * Readonly audit: for every product the bot cited in the 31-query stress test,
 * verify four things against the live BigCommerce API:
 *   1. Link resolves (HTTP 200 on https://performancecycle.com{path})
 *   2. Claimed price matches live calculated/sale price within $0.01
 *   3. Claimed stock phrase matches live inventory bucket
 *   4. Claimed variant (color/size) exists and is purchasable
 *
 * Output: scripts/link-audit-report-{timestamp}.md
 *
 * Run: npx tsx scripts/audit-bot-links.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, gte, like } from "drizzle-orm";
import { writeFileSync } from "fs";
import { resolve as resolvePath } from "path";

// ────────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────────

interface Citation {
  sessionId: string;
  customerIdentifier: string;
  firstUserQuery: string;
  productName: string;
  rawUrl: string;
  path: string;
  paragraph: string;
  claimedPrice: number | null;
  claimedStock: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | null;
  claimedStockCount: number | null;
  claimedColors: string[];
  claimedSizes: string[];
}

interface LinkFinding {
  session: string;
  query: string;
  productName: string;
  url: string;
  linkOk: "pass" | "fail" | "n/a";
  priceOk: "pass" | "fail" | "n/a";
  stockOk: "pass" | "fail" | "n/a";
  variantOk: "pass" | "fail" | "n/a";
  resolved: boolean;
  details: string[];
}

type StockBucket = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

// ────────────────────────────────────────────────────────────────────────────────
// Caches
// ────────────────────────────────────────────────────────────────────────────────

const httpStatusCache = new Map<string, number | null>();
const bcProductCache = new Map<number, unknown>(); // BCProduct
const urlToProductIdCache = new Map<string, number | null>();

const STORE_HOST = "performancecycle.com";

// We audit every session started within this many hours. The stress-test plan
// originally referred to `qa-revert-*` customerIdentifiers, but the live
// `/api/sessions` route overwrites incoming identifiers with `Customer #NNNN`,
// so the only reliable way to capture the 31-query stress battery is by time.
// Override with --hours=N on the command line.
const DEFAULT_LOOKBACK_HOURS = 48;

// ────────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────────

function normalizePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let path: string;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const u = new URL(trimmed);
      if (!u.hostname.toLowerCase().endsWith(STORE_HOST)) return null;
      path = u.pathname;
    } else if (trimmed.startsWith("/")) {
      path = trimmed;
    } else {
      return null;
    }
  } catch {
    return null;
  }
  // Normalize trailing slash — but skip file URLs (PDFs, images, etc.) where
  // adding "/" turns a real file into a 404.
  const last = path.split("/").filter(Boolean).pop() || "";
  const looksLikeFile = /\.[a-z0-9]{2,4}$/i.test(last);
  if (!looksLikeFile && !path.endsWith("/")) path = path + "/";
  return path.toLowerCase();
}

function absoluteUrl(path: string): string {
  return `https://${STORE_HOST}${path}`;
}

function liveStockBucket(
  inventoryLevel: number,
  inventoryTracking: string,
  availability: string,
): StockBucket {
  if (availability === "disabled") return "OUT_OF_STOCK";
  if (inventoryTracking === "none") return "IN_STOCK";
  if (inventoryLevel <= 0) return "OUT_OF_STOCK";
  if (inventoryLevel <= 5) return "LOW_STOCK";
  return "IN_STOCK";
}

function livePrice(p: {
  sale_price: number;
  calculated_price: number;
  price: number;
}): number {
  return p.sale_price || p.calculated_price || p.price;
}

// ────────────────────────────────────────────────────────────────────────────────
// Parsing — extract citations from an assistant message
// ────────────────────────────────────────────────────────────────────────────────

// Matches [Label](url) — allows nested parens in url by using lazy + balance hack.
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const PRICE_RE = /\$\s*([0-9]{1,4}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/;

function parseCitations(
  sessionId: string,
  customerIdentifier: string,
  firstUserQuery: string,
  assistantMessage: string,
  colorVocabulary: Set<string>,
): Citation[] {
  const citations: Citation[] = [];
  const seenPerMessage = new Set<string>();

  // Split into paragraphs (double newline or list item boundary)
  const paragraphs = assistantMessage.split(/\n\s*\n|\n(?=[-*]\s)/);

  for (const paragraph of paragraphs) {
    MARKDOWN_LINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_LINK_RE.exec(paragraph)) !== null) {
      const label = match[1].trim();
      const rawUrl = match[2].trim();
      const path = normalizePath(rawUrl);
      if (!path) continue; // not a store link

      const dedupeKey = `${sessionId}::${path}`;
      if (seenPerMessage.has(dedupeKey)) continue;
      seenPerMessage.add(dedupeKey);

      // Pull a focused window around the link for price/stock extraction:
      // everything in the paragraph within 200 chars after the link.
      const linkEnd = match.index + match[0].length;
      const window = paragraph.slice(match.index, Math.min(paragraph.length, linkEnd + 240));

      const priceMatch = window.match(PRICE_RE);
      let claimedPrice: number | null = null;
      if (priceMatch) {
        const n = parseFloat(priceMatch[1].replace(/,/g, ""));
        if (!Number.isNaN(n) && n > 0) claimedPrice = n;
      }

      // Stock detection — look at entire paragraph, not just post-link window,
      // because the phrase sometimes precedes the link.
      let claimedStock: StockBucket | null = null;
      let claimedStockCount: number | null = null;
      const lowerPara = paragraph.toLowerCase();
      const linkedSegment = lowerPara; // paragraph-scoped
      if (
        /\bout of stock\b/.test(linkedSegment) ||
        /\boos\b/.test(linkedSegment) ||
        /currently unavailable/.test(linkedSegment) ||
        /not (currently )?available/.test(linkedSegment)
      ) {
        claimedStock = "OUT_OF_STOCK";
      } else if (
        /\blow stock\b/.test(linkedSegment) ||
        /only\s+\d+\s+left/.test(linkedSegment) ||
        /\d+\s+left\b/.test(linkedSegment)
      ) {
        claimedStock = "LOW_STOCK";
        const leftMatch = linkedSegment.match(/(\d+)\s+left/);
        if (leftMatch) claimedStockCount = parseInt(leftMatch[1], 10);
      } else if (
        /\bin stock\b/.test(linkedSegment) ||
        /\d+\s+available\b/.test(linkedSegment)
      ) {
        claimedStock = "IN_STOCK";
        const availMatch = linkedSegment.match(/(\d+)\s+available/);
        if (availMatch) claimedStockCount = parseInt(availMatch[1], 10);
      }

      // Variant claims — extract colors and sizes from paragraph.
      const claimedColors: string[] = [];
      for (const color of colorVocabulary) {
        const re = new RegExp(
          `(^|[\\s/\\-_,.(])${color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s/\\-_,.)])`,
          "i",
        );
        if (re.test(paragraph)) claimedColors.push(color);
      }

      const claimedSizes: string[] = [];
      const sizeRegexes: RegExp[] = [
        /\bsize\s+(\d{1,2}(?:\.\d)?)\b/gi,
        /\bus\s+(\d{1,2}(?:\.\d)?)\b/gi,
        /\b(xxs|xs|sm|md|lg|xl|xxl|2xl|3xl|4xl)\b/gi,
      ];
      for (const re of sizeRegexes) {
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(paragraph)) !== null) {
          const token = m[1].toLowerCase();
          if (!claimedSizes.includes(token)) claimedSizes.push(token);
        }
      }

      citations.push({
        sessionId,
        customerIdentifier,
        firstUserQuery,
        productName: label,
        rawUrl,
        path,
        paragraph: paragraph.trim().slice(0, 400),
        claimedPrice,
        claimedStock,
        claimedStockCount,
        claimedColors,
        claimedSizes,
      });
    }
  }

  return citations;
}

// ────────────────────────────────────────────────────────────────────────────────
// Resolve URL -> BC product ID
// ────────────────────────────────────────────────────────────────────────────────

async function resolveUrlToProductId(
  path: string,
  opts: {
    dbRef: typeof import("../lib/db")["db"];
    schemaRef: typeof import("../lib/db/schema");
    bc: typeof import("../lib/bigcommerce/client");
    likeOp: typeof import("drizzle-orm")["like"];
  },
): Promise<number | null> {
  if (urlToProductIdCache.has(path)) return urlToProductIdCache.get(path)!;
  const { dbRef, schemaRef, bc, likeOp } = opts;

  // Try product_colorways first (has bcProductId keyed by URL)
  try {
    const cw = await dbRef
      .select({ id: schemaRef.productColorways.bcProductId, url: schemaRef.productColorways.url })
      .from(schemaRef.productColorways)
      .where(likeOp(schemaRef.productColorways.url, path))
      .limit(1);
    if (cw.length > 0 && cw[0].id) {
      urlToProductIdCache.set(path, cw[0].id);
      return cw[0].id;
    }
    // Case-insensitive contains fallback
    const cwLike = await dbRef
      .select({ id: schemaRef.productColorways.bcProductId, url: schemaRef.productColorways.url })
      .from(schemaRef.productColorways)
      .where(likeOp(schemaRef.productColorways.url, `%${path}%`))
      .limit(1);
    if (cwLike.length > 0 && cwLike[0].id) {
      urlToProductIdCache.set(path, cwLike[0].id);
      return cwLike[0].id;
    }
  } catch (e) {
    console.warn("[resolve] product_colorways lookup failed:", (e as Error).message);
  }

  // Try local_catalog next
  try {
    const lc = await dbRef
      .select({ id: schemaRef.localCatalog.bcProductId, url: schemaRef.localCatalog.url })
      .from(schemaRef.localCatalog)
      .where(likeOp(schemaRef.localCatalog.url, path))
      .limit(1);
    if (lc.length > 0 && lc[0].id) {
      urlToProductIdCache.set(path, lc[0].id);
      return lc[0].id;
    }
    const lcLike = await dbRef
      .select({ id: schemaRef.localCatalog.bcProductId, url: schemaRef.localCatalog.url })
      .from(schemaRef.localCatalog)
      .where(likeOp(schemaRef.localCatalog.url, `%${path}%`))
      .limit(1);
    if (lcLike.length > 0 && lcLike[0].id) {
      urlToProductIdCache.set(path, lcLike[0].id);
      return lcLike[0].id;
    }
  } catch (e) {
    console.warn("[resolve] local_catalog lookup failed:", (e as Error).message);
  }

  // Fall back to BC keyword search using last slug segment
  try {
    const slug = path.replace(/\/+$/g, "").split("/").filter(Boolean).pop() || "";
    const keyword = slug.replace(/-/g, " ");
    if (keyword.length >= 3) {
      const results = await bc.searchProductsBC(keyword);
      for (const p of results) {
        const candidate = p.custom_url?.url?.toLowerCase();
        if (candidate && candidate === path) {
          urlToProductIdCache.set(path, p.id);
          bcProductCache.set(p.id, p);
          return p.id;
        }
      }
      // Weak match: any product whose custom_url contains the slug
      for (const p of results) {
        const candidate = p.custom_url?.url?.toLowerCase() || "";
        if (candidate.includes(slug.toLowerCase())) {
          urlToProductIdCache.set(path, p.id);
          bcProductCache.set(p.id, p);
          return p.id;
        }
      }
    }
  } catch (e) {
    console.warn("[resolve] BC fallback search failed:", (e as Error).message);
  }

  urlToProductIdCache.set(path, null);
  return null;
}

// ────────────────────────────────────────────────────────────────────────────────
// HTTP HEAD with retry
// ────────────────────────────────────────────────────────────────────────────────

async function checkHttpStatus(url: string): Promise<number | null> {
  if (httpStatusCache.has(url)) return httpStatusCache.get(url)!;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 audit-bot-links/1.0" },
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }
      // Some stores reject HEAD — retry with GET if we get a weird 4xx
      if (res.status === 405 || res.status === 403) {
        const getRes = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 audit-bot-links/1.0" },
        });
        httpStatusCache.set(url, getRes.status);
        return getRes.status;
      }
      httpStatusCache.set(url, res.status);
      return res.status;
    } catch (e) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.warn(`[http] ${url} -> error: ${(e as Error).message}`);
      httpStatusCache.set(url, null);
      return null;
    }
  }
  httpStatusCache.set(url, null);
  return null;
}

// ────────────────────────────────────────────────────────────────────────────────
// Four-axis compare
// ────────────────────────────────────────────────────────────────────────────────

interface BCProductShape {
  id: number;
  name: string;
  price: number;
  sale_price: number;
  calculated_price: number;
  inventory_level: number;
  inventory_tracking: string;
  availability: string;
  custom_url: { url: string };
  variants?: {
    sku: string;
    inventory_level: number;
    option_values: { label: string; option_display_name: string }[];
  }[];
}

function compareCitationToLive(
  citation: Citation,
  live: BCProductShape,
  httpStatus: number | null,
  colorSynonymMap: Record<string, string[]>,
): LinkFinding {
  const details: string[] = [];

  // 1. Link
  const linkOk: "pass" | "fail" = httpStatus === 200 ? "pass" : "fail";
  if (linkOk === "fail") {
    details.push(`Link HTTP status: ${httpStatus ?? "network error"}`);
  }

  // 2. Price
  let priceOk: "pass" | "fail" | "n/a" = "n/a";
  if (citation.claimedPrice !== null) {
    const livePriceVal = livePrice(live);
    if (Math.abs(citation.claimedPrice - livePriceVal) <= 0.01) {
      priceOk = "pass";
    } else {
      priceOk = "fail";
      details.push(
        `Price drift: bot said $${citation.claimedPrice.toFixed(2)}, live $${livePriceVal.toFixed(2)}`,
      );
    }
  }

  // 3. Stock
  let stockOk: "pass" | "fail" | "n/a" = "n/a";
  if (citation.claimedStock) {
    const liveBucket = liveStockBucket(
      live.inventory_level,
      live.inventory_tracking,
      live.availability,
    );
    if (liveBucket === citation.claimedStock) {
      stockOk = "pass";
      // Extra: if bot asserted a specific count, check it
      if (citation.claimedStockCount !== null && live.inventory_tracking !== "none") {
        if (citation.claimedStockCount !== live.inventory_level) {
          stockOk = "fail";
          details.push(
            `Stock count drift: bot said ${citation.claimedStockCount}, live ${live.inventory_level}`,
          );
        }
      }
    } else {
      stockOk = "fail";
      details.push(
        `Stock bucket drift: bot said ${citation.claimedStock}, live ${liveBucket} (inv=${live.inventory_level}, tracking=${live.inventory_tracking}, avail=${live.availability})`,
      );
    }
  }

  // 4. Variants
  let variantOk: "pass" | "fail" | "n/a" = "n/a";
  if (citation.claimedColors.length > 0 || citation.claimedSizes.length > 0) {
    const variants = live.variants || [];
    if (variants.length === 0) {
      variantOk = "n/a";
      details.push(
        "Variant check skipped: no variant data on BC product",
      );
    } else {
      const failures: string[] = [];

      // Expand color vocabulary using synonym map
      const expandedClaimedColors = new Set<string>();
      for (const c of citation.claimedColors) {
        expandedClaimedColors.add(c.toLowerCase());
        for (const [primary, syns] of Object.entries(colorSynonymMap)) {
          if (primary === c.toLowerCase() || syns.includes(c.toLowerCase())) {
            expandedClaimedColors.add(primary);
            for (const s of syns) expandedClaimedColors.add(s);
          }
        }
      }

      for (const color of citation.claimedColors) {
        const matching = variants.filter((v) => {
          return (v.option_values || []).some((ov) => {
            const label = (ov.label || "").toLowerCase();
            const dn = (ov.option_display_name || "").toLowerCase();
            if (!/(color|colour|colorway|finish|style|graphics)/.test(dn)) return false;
            for (const candidate of expandedClaimedColors) {
              const re = new RegExp(
                `(^|[\\s/\\-_,.(])${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s/\\-_,.)])`,
                "i",
              );
              if (re.test(label) || label === candidate) return true;
            }
            return false;
          });
        });
        if (matching.length === 0) {
          failures.push(`phantom color "${color}" — no matching variant`);
          continue;
        }
        const purchasable = matching.some((v) => v.inventory_level > 0);
        if (!purchasable && live.inventory_tracking !== "none") {
          failures.push(`color "${color}" exists but all variants OOS`);
        }
      }

      for (const size of citation.claimedSizes) {
        const matching = variants.filter((v) =>
          (v.option_values || []).some((ov) => {
            const label = (ov.label || "").toLowerCase().trim();
            const dn = (ov.option_display_name || "").toLowerCase();
            if (!/(size|length|fit)/.test(dn)) return false;
            return label === size || label === size.toUpperCase();
          }),
        );
        if (matching.length === 0) {
          failures.push(`phantom size "${size}" — no matching variant`);
          continue;
        }
        const purchasable = matching.some((v) => v.inventory_level > 0);
        if (!purchasable && live.inventory_tracking !== "none") {
          failures.push(`size "${size}" exists but all variants OOS`);
        }
      }

      if (failures.length === 0) variantOk = "pass";
      else {
        variantOk = "fail";
        for (const f of failures) details.push(f);
      }
    }
  }

  return {
    session: citation.customerIdentifier,
    query: citation.firstUserQuery,
    productName: citation.productName,
    url: absoluteUrl(citation.path),
    linkOk,
    priceOk,
    stockOk,
    variantOk,
    resolved: true,
    details,
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// Report writer
// ────────────────────────────────────────────────────────────────────────────────

function renderReport(findings: LinkFinding[], totals: {
  sessions: number;
  citations: number;
  unresolved: number;
}): string {
  const lines: string[] = [];
  const ts = new Date().toISOString();
  const allPass = findings.filter(
    (f) =>
      f.resolved &&
      f.linkOk === "pass" &&
      (f.priceOk === "pass" || f.priceOk === "n/a") &&
      (f.stockOk === "pass" || f.stockOk === "n/a") &&
      (f.variantOk === "pass" || f.variantOk === "n/a"),
  );
  const fails = findings.filter((f) => !allPass.includes(f) || !f.resolved);

  const deadLinks = findings.filter((f) => f.resolved && f.linkOk === "fail");
  const priceFails = findings.filter((f) => f.priceOk === "fail");
  const stockFails = findings.filter((f) => f.stockOk === "fail");
  const variantFails = findings.filter((f) => f.variantOk === "fail");
  const unresolvedRows = findings.filter((f) => !f.resolved);

  lines.push(`# Bot Link & Variant Audit`);
  lines.push(``);
  lines.push(`Generated: ${ts}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`- Sessions scanned: **${totals.sessions}**`);
  lines.push(`- Total citations: **${totals.citations}**`);
  lines.push(`- Unresolved URLs (not found in catalog or BC): **${totals.unresolved}**`);
  lines.push(`- Passed all four checks: **${allPass.length}**`);
  lines.push(`- Failed at least one check: **${fails.length}**`);
  lines.push(`  - Dead links (HTTP != 200): **${deadLinks.length}**`);
  lines.push(`  - Price mismatches: **${priceFails.length}**`);
  lines.push(`  - Stock drift: **${stockFails.length}**`);
  lines.push(`  - Phantom/unpurchasable variants: **${variantFails.length}**`);
  lines.push(``);

  function renderSection(title: string, rows: LinkFinding[]) {
    lines.push(`## ${title} (${rows.length})`);
    lines.push(``);
    if (rows.length === 0) {
      lines.push(`_None._`);
      lines.push(``);
      return;
    }
    for (const f of rows) {
      lines.push(`### ${f.productName}`);
      lines.push(``);
      lines.push(`- Session: \`${f.session}\``);
      lines.push(`- Query: _${f.query}_`);
      lines.push(`- URL: ${f.url}`);
      if (f.details.length > 0) {
        lines.push(`- Details:`);
        for (const d of f.details) lines.push(`  - ${d}`);
      }
      lines.push(``);
    }
  }

  renderSection("Unresolved URLs", unresolvedRows);
  renderSection("Dead Links (HTTP != 200)", deadLinks);
  renderSection("Price Mismatches", priceFails);
  renderSection("Stock Drift", stockFails);
  renderSection("Phantom / Unpurchasable Variants", variantFails);

  lines.push(`## Full Appendix`);
  lines.push(``);
  lines.push(`| Session | Query | Product | Link | Price | Stock | Variant |`);
  lines.push(`| --- | --- | --- | :---: | :---: | :---: | :---: |`);
  for (const f of findings) {
    const query = f.query.replace(/\|/g, "\\|").slice(0, 60);
    const prod = f.productName.replace(/\|/g, "\\|").slice(0, 50);
    const name = `[${prod}](${f.url})`;
    lines.push(
      `| \`${f.session}\` | ${query} | ${name} | ${badge(f.linkOk, f.resolved)} | ${badge(f.priceOk, f.resolved)} | ${badge(f.stockOk, f.resolved)} | ${badge(f.variantOk, f.resolved)} |`,
    );
  }
  lines.push(``);

  return lines.join("\n");
}

function badge(state: "pass" | "fail" | "n/a", resolved: boolean): string {
  if (!resolved) return "UNRESOLVED";
  if (state === "pass") return "PASS";
  if (state === "fail") return "FAIL";
  return "n/a";
}

// ────────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[audit] Loading modules...");
  const { db } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const bc = await import("../lib/bigcommerce/client");
  const { colorSynonymMap } = await import("../lib/search/colorSynonyms");

  const colorVocabulary = new Set<string>();
  for (const [primary, synonyms] of Object.entries(colorSynonymMap)) {
    colorVocabulary.add(primary);
    for (const s of synonyms) if (!s.includes(" ")) colorVocabulary.add(s);
  }

  const hoursArg = process.argv.find((a) => a.startsWith("--hours="));
  const lookbackHours = hoursArg
    ? parseInt(hoursArg.split("=")[1], 10)
    : DEFAULT_LOOKBACK_HOURS;
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  console.log(`[audit] Querying sessions started after ${cutoff.toISOString()} (last ${lookbackHours}h)...`);

  const sessionRows = await db
    .select({
      id: schema.sessions.id,
      customerIdentifier: schema.sessions.customerIdentifier,
      startedAt: schema.sessions.startedAt,
    })
    .from(schema.sessions)
    .where(gte(schema.sessions.startedAt, cutoff));

  console.log(`[audit] Found ${sessionRows.length} recent sessions`);
  if (sessionRows.length === 0) {
    console.log("[audit] No sessions to audit. Exiting.");
    return;
  }

  // Sort newest first for cleaner report ordering
  sessionRows.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  // Collect all citations
  const allCitations: Citation[] = [];
  for (const s of sessionRows) {
    const msgs = await db
      .select({
        role: schema.messages.role,
        content: schema.messages.content,
        sentAt: schema.messages.sentAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, s.id))
      .orderBy(schema.messages.sentAt);

    const firstCustomer = msgs.find((m) => m.role === "customer");
    const firstUserQuery = (firstCustomer?.content || "").slice(0, 240);
    const aiMessages = msgs.filter((m) => m.role === "ai");

    for (const m of aiMessages) {
      const cits = parseCitations(
        s.id,
        s.customerIdentifier,
        firstUserQuery,
        m.content,
        colorVocabulary,
      );
      allCitations.push(...cits);
    }
  }
  console.log(`[audit] Extracted ${allCitations.length} product citations across ${sessionRows.length} sessions`);

  // Resolve each unique URL once
  const uniquePaths = Array.from(new Set(allCitations.map((c) => c.path)));
  console.log(`[audit] Unique product URLs to resolve: ${uniquePaths.length}`);

  const findings: LinkFinding[] = [];
  let unresolvedCount = 0;

  // Process citations
  let i = 0;
  for (const citation of allCitations) {
    i++;
    if (i % 10 === 0) console.log(`[audit] Processing citation ${i}/${allCitations.length}...`);

    const productId = await resolveUrlToProductId(citation.path, {
      dbRef: db,
      schemaRef: schema,
      bc,
      likeOp: like,
    });

    const url = absoluteUrl(citation.path);
    const httpStatus = await checkHttpStatus(url);

    if (!productId) {
      unresolvedCount++;
      findings.push({
        session: citation.customerIdentifier,
        query: citation.firstUserQuery,
        productName: citation.productName,
        url,
        linkOk: httpStatus === 200 ? "pass" : "fail",
        priceOk: "n/a",
        stockOk: "n/a",
        variantOk: "n/a",
        resolved: false,
        details: [
          `Could not resolve URL to a BC product (checked product_colorways, local_catalog, and BC keyword search).`,
          httpStatus === 200
            ? "URL does return 200 live — BC product may be hidden or catalog data is stale."
            : `HTTP status: ${httpStatus ?? "network error"}`,
        ],
      });
      continue;
    }

    let live = bcProductCache.get(productId) as BCProductShape | undefined;
    if (!live) {
      const fetched = await bc.getProductById(productId);
      if (fetched) {
        bcProductCache.set(productId, fetched);
        live = fetched as BCProductShape;
      }
    }

    if (!live) {
      findings.push({
        session: citation.customerIdentifier,
        query: citation.firstUserQuery,
        productName: citation.productName,
        url,
        linkOk: httpStatus === 200 ? "pass" : "fail",
        priceOk: "n/a",
        stockOk: "n/a",
        variantOk: "n/a",
        resolved: false,
        details: [
          `Resolved to product ID ${productId} but BC API returned no data.`,
        ],
      });
      unresolvedCount++;
      continue;
    }

    findings.push(compareCitationToLive(citation, live, httpStatus, colorSynonymMap));
  }

  // Render report
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = renderReport(findings, {
    sessions: sessionRows.length,
    citations: allCitations.length,
    unresolved: unresolvedCount,
  });
  const reportPath = resolvePath(process.cwd(), `scripts/link-audit-report-${timestamp}.md`);
  writeFileSync(reportPath, report, "utf8");

  // Summary line to stdout
  const passCount = findings.filter(
    (f) =>
      f.resolved &&
      f.linkOk === "pass" &&
      (f.priceOk === "pass" || f.priceOk === "n/a") &&
      (f.stockOk === "pass" || f.stockOk === "n/a") &&
      (f.variantOk === "pass" || f.variantOk === "n/a"),
  ).length;
  const failCount = findings.length - passCount;

  console.log("");
  console.log("────────────────────────────────────────────────────────────");
  console.log(
    `SUMMARY: ${allCitations.length} citations across ${sessionRows.length} sessions | ${passCount} pass | ${failCount} fail | ${unresolvedCount} unresolved`,
  );
  console.log(`Report: ${reportPath}`);
  console.log("────────────────────────────────────────────────────────────");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
