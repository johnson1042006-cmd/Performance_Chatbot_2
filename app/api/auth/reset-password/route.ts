import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getStaffSession, bustUserFlagCache } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

const MIN_LEN = 12;

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    // getStaffSession returns null for unauthenticated OR deactivated users,
    // so this covers the old "!user || !user.isActive" 401.
    const session = await getStaffSession();
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

    // Verify the current password by attempting a sign-in on a throwaway client
    // (persistSession: false — does not touch the user's real cookie session).
    const scratch = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { error: signInErr } = await scratch.auth.signInWithPassword({
      email: session.user.email,
      password: currentPassword,
    });
    if (signInErr) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 }
      );
    }

    // Set the new password (Supabase owns credentials now).
    const admin = createAdminClient();
    const { error: updErr } = await admin.auth.admin.updateUserById(
      session.user.id,
      { password: newPassword }
    );
    if (updErr) throw updErr;

    await db
      .update(users)
      .set({
        mustResetPassword: false,
        passwordUpdatedAt: new Date(),
      })
      .where(eq(users.id, session.user.id));

    bustUserFlagCache(session.user.id);

    log.info("auth.password_reset", { requestId, userId: session.user.id });

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
