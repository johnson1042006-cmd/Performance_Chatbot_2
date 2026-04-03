import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { knowledgeBase } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const DEFAULTS = {
  aiEnabled: true,
  fallbackTimerSeconds: 60,
};

export async function GET() {
  try {
    const [entry] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_settings"))
      .limit(1);

    if (!entry) {
      return NextResponse.json(DEFAULTS);
    }

    const parsed = JSON.parse(entry.content);
    return NextResponse.json({
      aiEnabled: parsed.aiEnabled ?? DEFAULTS.aiEnabled,
      fallbackTimerSeconds:
        parsed.fallbackTimerSeconds ?? DEFAULTS.fallbackTimerSeconds,
    });
  } catch {
    return NextResponse.json(DEFAULTS);
  }
}
