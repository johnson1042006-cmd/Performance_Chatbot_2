import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { cannedResponses } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

async function requireManager() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "store_manager") {
    return null;
  }
  return session;
}

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireManager();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const rows = await db
      .select()
      .from(cannedResponses)
      .orderBy(asc(cannedResponses.category), asc(cannedResponses.title));
    return NextResponse.json({ replies: rows });
  } catch (error) {
    log.error("admin.canned_get_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch canned replies" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireManager();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const replyBody = typeof body?.body === "string" ? body.body : "";
    const category =
      typeof body?.category === "string" ? body.category.trim() : "";
    if (!title || !replyBody || !category) {
      return NextResponse.json(
        { error: "title, body, and category are required" },
        { status: 400 }
      );
    }
    if (title.length > 120 || category.length > 60) {
      return NextResponse.json(
        { error: "title or category too long" },
        { status: 400 }
      );
    }
    const [row] = await db
      .insert(cannedResponses)
      .values({
        title,
        body: replyBody,
        category,
        createdBy: auth.user.id,
      })
      .returning();
    return NextResponse.json({ reply: row }, { status: 201 });
  } catch (error) {
    log.error("admin.canned_post_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to create canned reply" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireManager();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title || title.length > 120) {
        return NextResponse.json({ error: "invalid title" }, { status: 400 });
      }
      updates.title = title;
    }
    if (typeof body.body === "string") {
      if (body.body.length === 0) {
        return NextResponse.json({ error: "body is required" }, { status: 400 });
      }
      updates.body = body.body;
    }
    if (typeof body.category === "string") {
      const category = body.category.trim();
      if (!category || category.length > 60) {
        return NextResponse.json(
          { error: "invalid category" },
          { status: 400 }
        );
      }
      updates.category = category;
    }
    const [row] = await db
      .update(cannedResponses)
      .set(updates)
      .where(eq(cannedResponses.id, id))
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ reply: row });
  } catch (error) {
    log.error("admin.canned_patch_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to update canned reply" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireManager();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await db.delete(cannedResponses).where(eq(cannedResponses.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("admin.canned_delete_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to delete canned reply" },
      { status: 500 }
    );
  }
}
