import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAllAgentsWithPresence } from "@/lib/presence";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const agents = await getAllAgentsWithPresence();
    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Team presence error:", error);
    return NextResponse.json(
      { error: "Failed to fetch team presence" },
      { status: 500 }
    );
  }
}
