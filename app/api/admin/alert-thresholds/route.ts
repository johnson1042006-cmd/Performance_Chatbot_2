import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alertThresholds } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireManager } from "@/lib/auth/requireManager";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

const KINDS = new Set([
  "queue_depth",
  "ai_failure_rate_pct",
  "no_agents_online_during_hours",
]);

const COMPARATORS = new Set([">", ">=", "<", "<=", "=="]);

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    const rows = await db.select().from(alertThresholds);
    return NextResponse.json({ thresholds: rows });
  } catch (error) {
    log.error("admin.alert_thresholds_get_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch thresholds" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    const body = await req.json();
    const { kind, threshold, comparator, enabled, cooldownMin, metadata } =
      body ?? {};

    if (!KINDS.has(kind)) {
      return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    }
    if (!COMPARATORS.has(comparator)) {
      return NextResponse.json(
        { error: "invalid comparator" },
        { status: 400 }
      );
    }
    if (typeof threshold !== "number" && typeof threshold !== "string") {
      return NextResponse.json(
        { error: "threshold required" },
        { status: 400 }
      );
    }

    const [row] = await db
      .insert(alertThresholds)
      .values({
        kind,
        threshold: String(threshold),
        comparator,
        enabled: enabled ?? true,
        cooldownMin: typeof cooldownMin === "number" ? cooldownMin : 30,
        metadata: metadata ?? null,
      })
      .returning();

    return NextResponse.json({ threshold: row }, { status: 201 });
  } catch (error) {
    log.error("admin.alert_thresholds_post_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to create threshold" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    const body = await req.json();
    const { id, ...rest } = body ?? {};
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (rest.kind !== undefined) {
      if (!KINDS.has(rest.kind)) {
        return NextResponse.json({ error: "invalid kind" }, { status: 400 });
      }
      updates.kind = rest.kind;
    }
    if (rest.comparator !== undefined) {
      if (!COMPARATORS.has(rest.comparator)) {
        return NextResponse.json(
          { error: "invalid comparator" },
          { status: 400 }
        );
      }
      updates.comparator = rest.comparator;
    }
    if (rest.threshold !== undefined) {
      updates.threshold = String(rest.threshold);
    }
    if (rest.enabled !== undefined) updates.enabled = !!rest.enabled;
    if (rest.cooldownMin !== undefined) updates.cooldownMin = rest.cooldownMin;
    if (rest.metadata !== undefined) updates.metadata = rest.metadata;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    const [row] = await db
      .update(alertThresholds)
      .set(updates)
      .where(eq(alertThresholds.id, id))
      .returning();

    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ threshold: row });
  } catch (error) {
    log.error("admin.alert_thresholds_patch_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to update threshold" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    await db.delete(alertThresholds).where(eq(alertThresholds.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("admin.alert_thresholds_delete_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to delete threshold" },
      { status: 500 }
    );
  }
}
