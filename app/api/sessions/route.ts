import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { desc, eq, ne } from "drizzle-orm";

export async function GET() {
  try {
    const allSessions = await db
      .select()
      .from(sessions)
      .where(ne(sessions.status, "closed"))
      .orderBy(desc(sessions.startedAt));

    return NextResponse.json({ sessions: allSessions });
  } catch (error) {
    console.error("Failed to fetch sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { customerIdentifier, pageContext } = body;

    const existing = await db
      .select()
      .from(sessions)
      .where(eq(sessions.customerIdentifier, customerIdentifier))
      .orderBy(desc(sessions.startedAt))
      .limit(1);

    if (existing.length > 0 && existing[0].status !== "closed") {
      return NextResponse.json({ session: existing[0] });
    }

    const [session] = await db
      .insert(sessions)
      .values({
        customerIdentifier,
        pageContext,
        status: "waiting",
      })
      .returning();

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("Failed to create session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
