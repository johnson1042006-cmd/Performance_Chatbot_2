import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions, users, messages, chatEvents } from "@/lib/db/schema";
import { asc, desc, eq, ne, sql, inArray, and } from "drizzle-orm";
import { processDueAiClaims, sweepStaleSessions } from "@/lib/sessions/state";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { extractGeoFromHeaders } from "@/lib/utils/geo";
import { log, serializeError } from "@/lib/log";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    // Lazy tick: expire stale sessions and process AI claims
    await Promise.allSettled([sweepStaleSessions(), processDueAiClaims()]);

    const rows = await db
      .select({
        session: sessions,
        claimerName: users.name,
        claimerId: users.id,
      })
      .from(sessions)
      .leftJoin(users, eq(sessions.claimedByUserId, users.id))
      .where(ne(sessions.status, "closed"))
      .orderBy(
        // Unclaimed sessions oldest-first, then claimed sessions newest-first
        asc(sessions.startedAt)
      );

    // Phase 3: derive a per-session "quality flag" from messages.confidence
    // / messages.sentiment so SessionCard can render a small red dot. We
    // compute it as a single aggregate query keyed by session_id so the
    // listing endpoint stays one DB round-trip even with many sessions.
    const sessionIds = rows.map((r) => r.session.id);
    const qualityBySessionId = new Map<
      string,
      { lowConfidenceLatest: boolean; negativeSentimentEver: boolean }
    >();
    if (sessionIds.length > 0) {
      const aggregates = await db
        .select({
          sessionId: messages.sessionId,
          negativeSentimentEver: sql<boolean>`bool_or(${messages.role} = 'ai' AND ${messages.sentiment} = -1)`,
          // The most recent AI confidence wins; selects "low" when the
          // newest AI row is low.
          latestAiConfidence: sql<string | null>`
            (array_agg(${messages.confidence} ORDER BY ${messages.sentAt} DESC)
             FILTER (WHERE ${messages.role} = 'ai' AND ${messages.confidence} IS NOT NULL))[1]
          `,
        })
        .from(messages)
        .where(inArray(messages.sessionId, sessionIds))
        .groupBy(messages.sessionId);
      for (const a of aggregates) {
        qualityBySessionId.set(a.sessionId, {
          lowConfidenceLatest: a.latestAiConfidence === "low",
          negativeSentimentEver: !!a.negativeSentimentEver,
        });
      }
    }

    // Sessions that fired auto_escalated but are still AI-claimed are
    // effectively pending a human — count them toward the queue badge.
    const escalatedPendingSet = new Set<string>();
    if (sessionIds.length > 0) {
      const escalatedRows = await db
        .select({ sessionId: chatEvents.sessionId })
        .from(chatEvents)
        .where(
          and(
            inArray(chatEvents.sessionId, sessionIds),
            eq(chatEvents.type, "auto_escalated")
          )
        );
      for (const r of escalatedRows) escalatedPendingSet.add(r.sessionId);
    }

    const enriched = rows.map(({ session, claimerName, claimerId }) => ({
      ...session,
      claimedBy: claimerId ? { id: claimerId, name: claimerName } : null,
      waitSeconds: Math.floor(
        (Date.now() - new Date(session.startedAt).getTime()) / 1000
      ),
      qualityFlag:
        qualityBySessionId.get(session.id) ?? {
          lowConfidenceLatest: false,
          negativeSentimentEver: false,
        },
      pendingHuman:
        escalatedPendingSet.has(session.id) &&
        session.claimedByKind !== "human" &&
        session.status !== "closed",
    }));

    // Sort: put pendingHuman sessions alongside waiting ones at the top.
    enriched.sort((a, b) => {
      const aNeedsHuman = a.status === "waiting" || a.pendingHuman;
      const bNeedsHuman = b.status === "waiting" || b.pendingHuman;
      if (aNeedsHuman && !bNeedsHuman) return -1;
      if (!aNeedsHuman && bNeedsHuman) return 1;
      if (aNeedsHuman && bNeedsHuman) {
        return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      }
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });

    const unclaimedCount = enriched.filter(
      (s) => s.status === "waiting" || s.pendingHuman
    ).length;

    return NextResponse.json({ sessions: enriched, unclaimedCount });
  } catch (error) {
    log.error("sessions.list_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    // IP rate limit: 5 new sessions per minute per IP. Caps abuse from a
    // single client trying to spawn endless conversations.
    const ip = getClientIp(req);
    const rl = await enforce(`sessions:${ip}`, 5, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter ?? 60) },
        }
      );
    }

    const body = await req.json();
    const { customerIdentifier, pageContext } = body;

    const effectiveId =
      typeof customerIdentifier === "string" && customerIdentifier.length > 0
        ? customerIdentifier
        : `anon_${crypto.randomUUID()}`;

    const existing = await db
      .select()
      .from(sessions)
      .where(eq(sessions.customerIdentifier, effectiveId))
      .orderBy(desc(sessions.startedAt))
      .limit(1);

    if (existing.length > 0 && existing[0].status !== "closed") {
      // Touch the activity timestamp so the stale sweep cannot close this
      // session in the window between now and the widget's first heartbeat
      // (which fires ~1 s after dbSessionId is set). Without this, a
      // returning customer whose session has stale timestamps from a previous
      // visit can have their session swept before they send their first
      // message, causing the chat API to return 410 "This conversation has
      // ended."
      const now = new Date();
      await db
        .update(sessions)
        .set({ lastCustomerActivityAt: now })
        .where(eq(sessions.id, existing[0].id));
      return NextResponse.json({
        session: { ...existing[0], lastCustomerActivityAt: now },
      });
    }

    // Phase 4: capture Vercel-derived IP geolocation for agent-only context.
    // Wrapped in try/catch so a missing edge runtime / local dev / unexpected
    // header parse failure never blocks session creation.
    let geoColumns: {
      customerCity?: string | null;
      customerRegion?: string | null;
      customerCountry?: string | null;
    } = {};
    try {
      const geo = extractGeoFromHeaders(req);
      if (geo.city || geo.region || geo.country) {
        geoColumns = {
          customerCity: geo.city,
          customerRegion: geo.region,
          customerCountry: geo.country,
        };
      }
    } catch {
      // Swallow — geolocation is best-effort.
    }

    const [session] = await db
      .insert(sessions)
      .values({
        customerIdentifier: effectiveId,
        pageContext,
        status: "waiting",
        ...geoColumns,
      })
      .returning();

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    log.error("sessions.create_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
