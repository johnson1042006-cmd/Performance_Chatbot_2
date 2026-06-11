/**
 * AI conversation tagger.
 *
 * After a session closes (via the explicit close endpoint or the stale
 * sweep), this module sends the transcript to Claude and asks for a strict
 * JSON object {intent, topics, resolved}. The result is persisted onto
 * sessions.intent / sessions.topic_tags / sessions.resolved and feeds the
 * Insights page (top intents, unanswered list).
 *
 * Failure mode: ALWAYS fail open — on any parse / API / DB error we still
 * record `{intent: "other", topics: [], resolved: false}` so the row no
 * longer shows up as "untagged" in our metrics. The warning is logged so a
 * subsequent investigation can find it. Tagging is fire-and-forget; close
 * paths never block on it.
 *
 * Concurrency: the `sem` counter caps concurrent in-flight tag calls per
 * Lambda invocation. Vercel's serverless model means each instance has its
 * own counter, but since tagging is idempotent (re-run leaves the same row),
 * occasionally exceeding 5 globally is fine. The guard's purpose is to
 * stop a flood of close-events from blowing through the Anthropic rate
 * limit inside a single instance.
 */
import { db } from "@/lib/db";
import { messages, sessions } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { callClaude } from "./callClaude";
import { log, serializeError } from "@/lib/log";

export const INTENTS = [
  "order_status",
  "returns_exchanges",
  "shipping_question",
  "gift_card_question",
  "helmet_sizing",
  "tire_fitment",
  "tech_air_service",
  "product_recommendation",
  "availability_check",
  "financing_question",
  "warranty_claim",
  "service_appointment",
  "complaint",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

export interface TagResult {
  intent: Intent;
  topics: string[];
  resolved: boolean;
}

const FAIL_OPEN: TagResult = {
  intent: "other",
  topics: [],
  resolved: false,
};

const TRANSCRIPT_LIMIT = 40;
const MAX_TOPICS = 10;
const MAX_TOPIC_LEN = 60;

const sem = { active: 0, max: 5 };

const SYSTEM_PROMPT = `You are a conversation classifier for a cycling and motorcycle apparel retailer's support chat.

Read the entire transcript and classify it into a single intent, free-form topic tags, and whether it was resolved.

Output STRICTLY a single JSON object — no prose, no code fences, no commentary. The shape MUST be exactly:

{
  "intent": "<one of the enum values below>",
  "topics": ["<short topic>", "<another>"],
  "resolved": true | false
}

Rules:
- "intent" MUST be one of: ${INTENTS.join(", ")}.
- If nothing fits well, use "other".
- "topics" is 0–10 short kebab-case strings (e.g. "agv-helmet", "return-shipping"). Lowercase, no punctuation.
- "resolved" is true if the customer's question received a complete, accurate, on-point answer — even if the customer did not reply to confirm. It is false if the question was deflected, partially answered, escalated without an answer, or the AI said it could not help.
- Never include any text outside the JSON object.`;

/**
 * Strip optional ```json ... ``` fences and parse. Returns null on failure.
 */
function safeParse(text: string): unknown {
  if (!text) return null;
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    s = s.trim();
  }
  try {
    return JSON.parse(s);
  } catch {
    // Try to extract the first {...} block as a last resort.
    const match = s.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function validate(raw: unknown): TagResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const intent = obj.intent;
  if (typeof intent !== "string") return null;
  if (!(INTENTS as readonly string[]).includes(intent)) return null;
  const topicsRaw = Array.isArray(obj.topics) ? obj.topics : [];
  const topics = topicsRaw
    .filter((t): t is string => typeof t === "string")
    .map((t) =>
      t
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-_ ]+/g, "")
        .replace(/\s+/g, "-")
        .slice(0, MAX_TOPIC_LEN)
    )
    .filter((t) => t.length > 0)
    .slice(0, MAX_TOPICS);
  const resolved = obj.resolved;
  if (typeof resolved !== "boolean") return null;
  return { intent: intent as Intent, topics, resolved };
}

async function loadTranscript(sessionId: string): Promise<string> {
  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.sentAt))
    .limit(TRANSCRIPT_LIMIT);
  if (rows.length === 0) return "";
  return rows
    .map((r) => `[${r.role}] ${r.content}`)
    .join("\n");
}

/**
 * Test hook. When set to "1", `tagSession` skips the Anthropic call and
 * returns a deterministic result. Wired by the Playwright e2e suite so CI
 * stays hermetic.
 *
 * Hard guard: in production we ignore TAGGER_TEST_MODE entirely so a leaked
 * env var can never contaminate real sessions with the deterministic
 * "test-tag" result.
 */
function isTestMode(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.TAGGER_TEST_MODE === "1";
}

function testModeResult(transcript: string): TagResult {
  // Transcript-aware so the e2e check can assert intent !== null and
  // topics has content even when callClaude is not exercised.
  const lower = transcript.toLowerCase();
  let intent: Intent = "other";
  if (lower.includes("order")) intent = "order_status";
  else if (lower.includes("return") || lower.includes("exchange"))
    intent = "returns_exchanges";
  else if (lower.includes("ship")) intent = "shipping_question";
  else if (lower.includes("helmet")) intent = "helmet_sizing";
  else if (lower.includes("tire")) intent = "tire_fitment";
  return { intent, topics: ["test-tag"], resolved: false };
}

/**
 * Run the tagger on a single session. Always persists a row even on
 * failure (fail-open). Returns the persisted result for testability.
 */
export async function tagSession(sessionId: string): Promise<TagResult> {
  let result: TagResult = FAIL_OPEN;
  try {
    const transcript = await loadTranscript(sessionId);
    if (!transcript) {
      // Empty session — nothing to classify. Persist FAIL_OPEN and exit.
      await persist(sessionId, FAIL_OPEN);
      return FAIL_OPEN;
    }
    if (isTestMode()) {
      log.warn("tagger.test_mode_active", { sessionId });
      result = testModeResult(transcript);
      await persist(sessionId, result);
      return result;
    }
    const text = await callClaude(SYSTEM_PROMPT, [
      { role: "user", content: transcript },
    ]);
    const parsed = validate(safeParse(text));
    if (!parsed) {
      log.warn("tagger.parse_failed", {
        sessionId,
        sample: text?.slice(0, 200),
      });
      result = FAIL_OPEN;
    } else {
      result = parsed;
    }
  } catch (error) {
    log.warn("tagger.failed", {
      sessionId,
      error: serializeError(error),
    });
    result = FAIL_OPEN;
  }
  try {
    await persist(sessionId, result);
  } catch (error) {
    log.warn("tagger.persist_failed", {
      sessionId,
      error: serializeError(error),
    });
  }
  return result;
}

async function persist(sessionId: string, r: TagResult): Promise<void> {
  await db
    .update(sessions)
    .set({
      intent: r.intent,
      topicTags: r.topics,
      resolved: r.resolved,
    })
    .where(eq(sessions.id, sessionId));
}

/**
 * Fire-and-forget queue entry. Drops if the per-instance semaphore is
 * full so close paths cannot stack up. Safe to call from anywhere.
 */
export function enqueueTag(sessionId: string): void {
  if (sem.active >= sem.max) {
    log.info("tagger.semaphore_skip", {
      sessionId,
      active: sem.active,
      max: sem.max,
    });
    return;
  }
  sem.active += 1;
  void tagSession(sessionId).finally(() => {
    sem.active = Math.max(0, sem.active - 1);
  });
}

/**
 * Test-only hook: wait until the in-flight semaphore drains. Not exported
 * via the package barrel; callers in unit tests can still import it
 * directly when they need to reason about concurrency.
 */
export async function _drainForTests(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (sem.active > 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
}
