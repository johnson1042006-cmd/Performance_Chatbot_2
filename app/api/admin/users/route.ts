import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { passwordResetGate } from "@/lib/auth/passwordResetGate";
import { createAdminClient } from "@/lib/supabase/admin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

const TEMP_PASSWORD_MIN_LEN = 12;

/** Postgres unique-constraint violation (duplicate email). */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const cause = (error as { cause?: { code?: string } }).cause;
  return code === "23505" || cause?.code === "23505";
}

/** Supabase Auth duplicate-email error (from admin.createUser). */
function isSupabaseDuplicate(error: { code?: string; status?: number; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "email_exists" ||
    error.status === 422 ||
    /already.*regist|already exists/i.test(error.message ?? "")
  );
}

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    const resetDenied = passwordResetGate(session);
    if (resetDenied) return resetDenied;
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users);

    return NextResponse.json({ users: allUsers });
  } catch (error) {
    log.error("admin.users_get_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    const resetDenied = passwordResetGate(session);
    if (resetDenied) return resetDenied;
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { email, name, password, role = "support_agent" } = body;

    if (!email || !name || !password) {
      return NextResponse.json(
        { error: "email, name, and password are required" },
        { status: 400 }
      );
    }

    if (role !== "support_agent" && role !== "store_manager") {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Same policy as /api/auth/reset-password so the temp password the
    // manager picks is held to the same bar as the one the agent sets later.
    if (
      typeof password !== "string" ||
      password.length < TEMP_PASSWORD_MIN_LEN ||
      !/\d/.test(password) ||
      !/[A-Za-z]/.test(password)
    ) {
      return NextResponse.json(
        {
          error:
            "Password must be at least 12 characters and include both a letter and a number.",
        },
        { status: 400 }
      );
    }

    // Create the Supabase auth identity first (it owns credentials now), then
    // mirror a public.users profile row keyed on the same id. email_confirm so
    // the invitee is immediately active with no confirmation email.
    const admin = createAdminClient();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createErr || !created?.user) {
      if (isSupabaseDuplicate(createErr)) {
        return NextResponse.json(
          { error: "A user with that email already exists." },
          { status: 409 }
        );
      }
      throw createErr ?? new Error("Supabase createUser returned no user");
    }

    // mustResetPassword: the invited teammate signs in with the temp password
    // the manager chose, then is forced to set their own on first login.
    let user;
    try {
      [user] = await db
        .insert(users)
        .values({
          id: created.user.id,
          email,
          name,
          role,
          mustResetPassword: true,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
          createdAt: users.createdAt,
        });
    } catch (insertErr) {
      // Roll back the orphaned auth user so a retry isn't blocked by a
      // half-created account.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
      if (isUniqueViolation(insertErr)) {
        return NextResponse.json(
          { error: "A user with that email already exists." },
          { status: 409 }
        );
      }
      throw insertErr;
    }

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    log.error("admin.users_post_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    const resetDenied = passwordResetGate(session);
    if (resetDenied) return resetDenied;
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { id, role, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (role !== undefined) updates.role = role;
    if (isActive !== undefined) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
      });

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: updated });
  } catch (error) {
    log.error("admin.users_patch_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
