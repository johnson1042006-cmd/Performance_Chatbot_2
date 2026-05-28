/**
 * Test-only endpoint for Playwright e2e specs. Inserts customer messages
 * directly into the DB without triggering Claude or Pusher, so tests that
 * need "frustrated" / "angry" messages to be present before session-close
 * don't have to wait for real AI calls (which can take 10-30 s and exhaust
 * the 30-second Playwright test timeout).
 *
 * Only available when E2E_EMAIL_MOCK=1 (the standard e2e mock flag).
 *
 * Body: { sessionId: string; role?: "customer" | "ai"; messages: Array<{ content: string }> }
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";

export async function POST(req: Request) {
  if (process.env.E2E_EMAIL_MOCK !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json()) as {
    sessionId?: string;
    role?: "customer" | "ai";
    messages?: Array<{ content: string }>;
  };

  if (!body.sessionId || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const role = body.role === "ai" ? "ai" : "customer";

  const rows = body.messages.map((m) => ({
    sessionId: body.sessionId as string,
    role: role as "customer" | "ai",
    content: m.content,
    redactionHits: [] as string[],
  }));

  const inserted = await db.insert(messages).values(rows).returning({ id: messages.id });
  return NextResponse.json({ inserted: inserted.length });
}
