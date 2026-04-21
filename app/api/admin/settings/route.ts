import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { knowledgeBase } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const DEFAULT_SETTINGS = {
  aiEnabled: true,
  fallbackTimerSeconds: 60,
};

export async function GET() {
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
    console.error("Settings GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

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
    console.error("Settings POST error:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
