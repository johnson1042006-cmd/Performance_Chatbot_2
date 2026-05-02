import { db } from "@/lib/db";
import { sessions, messages, knowledgeBase } from "@/lib/db/schema";
import { eq, lt, inArray } from "drizzle-orm";

export interface CleanupResult {
  ranAt: string;
  retentionMonths: number;
  cutoff: string | null;
  deletedSessions: number;
  deletedMessages: number;
  skipped: boolean;
  reason?: string;
}

export async function getRetentionMonths(): Promise<number> {
  const [entry] = await db
    .select()
    .from(knowledgeBase)
    .where(eq(knowledgeBase.topic, "bot_settings"))
    .limit(1);

  if (!entry) return 0;

  try {
    const settings = JSON.parse(entry.content) as {
      historyRetentionMonths?: number;
    };
    const months = Number(settings.historyRetentionMonths);
    return Number.isFinite(months) && months > 0 ? Math.floor(months) : 0;
  } catch {
    return 0;
  }
}

export async function runChatHistoryCleanup(
  overrideMonths?: number
): Promise<CleanupResult> {
  const ranAt = new Date().toISOString();
  const retentionMonths =
    overrideMonths !== undefined ? overrideMonths : await getRetentionMonths();

  if (!retentionMonths || retentionMonths <= 0) {
    return {
      ranAt,
      retentionMonths: 0,
      cutoff: null,
      deletedSessions: 0,
      deletedMessages: 0,
      skipped: true,
      reason: "Retention disabled",
    };
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);

  const stale = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lt(sessions.startedAt, cutoff));

  if (stale.length === 0) {
    return {
      ranAt,
      retentionMonths,
      cutoff: cutoff.toISOString(),
      deletedSessions: 0,
      deletedMessages: 0,
      skipped: false,
    };
  }

  const ids = stale.map((s) => s.id);

  const deletedMsgs = await db
    .delete(messages)
    .where(inArray(messages.sessionId, ids))
    .returning({ id: messages.id });

  const deletedSess = await db
    .delete(sessions)
    .where(inArray(sessions.id, ids))
    .returning({ id: sessions.id });

  return {
    ranAt,
    retentionMonths,
    cutoff: cutoff.toISOString(),
    deletedSessions: deletedSess.length,
    deletedMessages: deletedMsgs.length,
    skipped: false,
  };
}
