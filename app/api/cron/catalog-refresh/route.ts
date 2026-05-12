import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { knowledgeBase } from "@/lib/db/schema";
import { dumpCatalog } from "@/lib/catalog/dump";
import {
  buildSkeletonFromDump,
  formatSkeletonForPrompt,
} from "@/lib/catalog/skeleton";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * BC pagination over ~5,600+ products takes ~30–60 s; 300 s gives ample
 * headroom without hitting Vercel's absolute limit.
 */
export const maxDuration = 300;

/**
 * Nightly cron handler: fetch the full BC catalog, rebuild the skeleton, and
 * upsert knowledge_base where topic = "store_catalog_index".
 *
 * Schedule: 30 7 * * *  (07:30 UTC ≈ 00:30 Mountain — well outside store hours)
 *
 * Verify manually before the schedule fires:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<your-domain>/api/cron/catalog-refresh
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();

  try {
    const dump = await dumpCatalog();

    const skeleton = buildSkeletonFromDump(dump);
    const content = formatSkeletonForPrompt(skeleton);

    await db
      .insert(knowledgeBase)
      .values({ topic: "store_catalog_index", content, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: knowledgeBase.topic,
        set: { content, updatedAt: new Date() },
      });

    const durationMs = Date.now() - t0;

    log.info("cron.catalog_refresh_done", {
      totalProducts: dump.totalProducts,
      skeletonChars: content.length,
      durationMs,
    });

    return NextResponse.json({
      success: true,
      totalProducts: dump.totalProducts,
      skeletonChars: content.length,
      durationMs,
    });
  } catch (error) {
    log.error("cron.catalog_refresh_failed", {
      error: serializeError(error),
      durationMs: Date.now() - t0,
    });
    return NextResponse.json(
      { error: "Catalog refresh failed" },
      { status: 500 }
    );
  }
}
