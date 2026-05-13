import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { knowledgeBase } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

const DEFAULT_PERSONA = {
  name: "Agent",
  title: "Product Specialist",
  avatarUrl: "/agent-avatar.svg",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Public boot config for the embed loader (public/embed.js) and the chat
 * widget (components/chat/ChatWidget.tsx). Returns:
 *  - autoOpenOnFirstVisit: pulled from the bot_settings KB row
 *  - persona: pulled from the bot_persona KB row
 *
 * Both rows are JSON in `knowledge_base.content`. We default safely if either
 * row is missing or malformed so a fresh deploy works without the seed step.
 *
 * 60-second CDN cache — the values change rarely (manager edits) and a
 * minute of staleness is the right trade vs. hitting the DB on every embed
 * page load.
 */
export async function GET() {
  const requestId = crypto.randomUUID();
  let autoOpenOnFirstVisit = true;
  let persona = DEFAULT_PERSONA;

  try {
    const rows = await db
      .select()
      .from(knowledgeBase)
      .where(inArray(knowledgeBase.topic, ["bot_settings", "bot_persona"]));

    for (const row of rows) {
      if (row.topic === "bot_settings") {
        try {
          const parsed = JSON.parse(row.content);
          if (typeof parsed.autoOpenOnFirstVisit === "boolean") {
            autoOpenOnFirstVisit = parsed.autoOpenOnFirstVisit;
          }
        } catch {
          // Fall through to default; managers who manually edit the row to
          // invalid JSON shouldn't break the embed.
        }
      } else if (row.topic === "bot_persona") {
        try {
          const parsed = JSON.parse(row.content);
          persona = {
            name: typeof parsed.name === "string" ? parsed.name : DEFAULT_PERSONA.name,
            title:
              typeof parsed.title === "string"
                ? parsed.title
                : DEFAULT_PERSONA.title,
            avatarUrl:
              typeof parsed.avatarUrl === "string"
                ? parsed.avatarUrl
                : DEFAULT_PERSONA.avatarUrl,
          };
        } catch {
          // ditto
        }
      }
    }
  } catch (error) {
    log.warn("embed.config_failed", {
      requestId,
      error: serializeError(error),
    });
  }

  return NextResponse.json(
    { autoOpenOnFirstVisit, persona },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}
