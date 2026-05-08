import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { knowledgeBase } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

const DEFAULT_SETTINGS = {
  aiEnabled: true,
  fallbackTimerSeconds: 60,
  historyRetentionMonths: 0,
  // When true, the embed widget opens automatically on a visitor's first
  // page-view in the session (gated on a per-session sessionStorage key).
  autoOpenOnFirstVisit: true,
  // Phase 4: agent hotkeys (J/K navigate, C claim, R release, X close,
  // / focus reply, Cmd/Ctrl+Enter send). Manager-controlled.
  hotkeysEnabled: true,
  // Phase 5.5: ticketing. autoTicketOnEscalation gates the autoCreate hook
  // off /api/sessions/close + sweepStaleSessions. autoTicketEmailEnabled
  // toggles the customer "ticket received" email on auto-create. The
  // slaWindowsHours map is used for `due_at = now() + slaWindowsHours[priority]`
  // and the cron breach sweep.
  autoTicketOnEscalation: true,
  autoTicketEmailEnabled: true,
  slaWindowsHours: { urgent: 2, high: 4, normal: 24, low: 72 },
};

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [entry] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_settings"))
      .limit(1);

    if (!entry) {
      return NextResponse.json({ settings: DEFAULT_SETTINGS });
    }

    try {
      const settings = JSON.parse(entry.content);
      return NextResponse.json({ settings: { ...DEFAULT_SETTINGS, ...settings } });
    } catch {
      return NextResponse.json({ settings: DEFAULT_SETTINGS });
    }
  } catch (error) {
    log.error("admin.settings_get_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // Server-side validation / defence-in-depth
    if (typeof body.fallbackTimerSeconds === "number") {
      body.fallbackTimerSeconds = Math.min(300, Math.max(10, Math.round(body.fallbackTimerSeconds)));
    }

    await db
      .insert(knowledgeBase)
      .values({
        topic: "bot_settings",
        content: JSON.stringify(body),
      })
      .onConflictDoUpdate({
        target: knowledgeBase.topic,
        set: {
          content: JSON.stringify(body),
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ settings: body });
  } catch (error) {
    log.error("admin.settings_post_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
