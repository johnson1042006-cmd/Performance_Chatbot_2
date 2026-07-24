import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { knowledgeBase } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const entries = await db.select().from(knowledgeBase);
    return NextResponse.json({ entries });
  } catch (error) {
    log.error("admin.knowledge_get_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to fetch knowledge base" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { topic, content, isFaq } = body;

    if (!topic || !content) {
      return NextResponse.json(
        { error: "topic and content are required" },
        { status: 400 }
      );
    }

    // Phase 5: `isFaq` defaults to false on insert so existing seeded
    // policy topics keep their classification. On update we keep the
    // existing value unless the caller explicitly passes a new one.
    const updateSet: Record<string, unknown> = {
      content,
      updatedAt: new Date(),
    };
    if (typeof isFaq === "boolean") {
      updateSet.isFaq = isFaq;
    }

    const [entry] = await db
      .insert(knowledgeBase)
      .values({
        topic,
        content,
        isFaq: typeof isFaq === "boolean" ? isFaq : false,
      })
      .onConflictDoUpdate({
        target: knowledgeBase.topic,
        set: updateSet,
      })
      .returning();

    return NextResponse.json({ entry });
  } catch (error) {
    log.error("admin.knowledge_post_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to save knowledge entry" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("admin.knowledge_delete_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to delete" },
      { status: 500 }
    );
  }
}
