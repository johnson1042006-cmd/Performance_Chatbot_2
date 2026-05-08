import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, bustUserFlagCache } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { log, serializeError } from "@/lib/log";

const MIN_LEN = 12;

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { currentPassword, newPassword } = body ?? {};

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return NextResponse.json(
        { error: "currentPassword and newPassword are required" },
        { status: 400 }
      );
    }

    if (
      newPassword.length < MIN_LEN ||
      !/\d/.test(newPassword) ||
      !/[A-Za-z]/.test(newPassword)
    ) {
      return NextResponse.json(
        {
          error:
            "New password must be at least 12 characters and include both a letter and a number.",
        },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must differ from current password." },
        { status: 400 }
      );
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!user || !user.isActive) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 }
      );
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(users)
      .set({
        passwordHash: newHash,
        mustResetPassword: false,
        passwordUpdatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    bustUserFlagCache(user.id);

    log.info("auth.password_reset", { requestId, userId: user.id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("auth.password_reset_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to reset password" },
      { status: 500 }
    );
  }
}
