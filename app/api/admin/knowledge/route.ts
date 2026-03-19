import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { knowledgeBase } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const entries = await db.select().from(knowledgeBase);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Knowledge GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch knowledge base" },
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
    const { topic, content } = body;

    if (!topic || !content) {
      return NextResponse.json(
        { error: "topic and content are required" },
        { status: 400 }
      );
    }

    const [entry] = await db
      .insert(knowledgeBase)
      .values({ topic, content })
      .onConflictDoUpdate({
        target: knowledgeBase.topic,
        set: { content, updatedAt: new Date() },
      })
      .returning();

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Knowledge POST error:", error);
    return NextResponse.json(
      { error: "Failed to save knowledge entry" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
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
    console.error("Knowledge DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete" },
      { status: 500 }
    );
  }
}
