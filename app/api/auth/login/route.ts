import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

/**
 * Server-side staff login. Routing sign-in through here (instead of calling
 * supabase.auth.signInWithPassword straight from the browser) preserves the
 * per-IP rate limit and the isActive check that lived in NextAuth's
 * authorize(). The @supabase/ssr server client sets the auth cookies on the
 * response. Errors are deliberately generic so we don't telegraph which of
 * (rate-limited / unknown email / bad password / deactivated) occurred.
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const generic = NextResponse.json(
    { error: "Invalid email or password" },
    { status: 401 }
  );

  try {
    // Rate limit by IP before any auth work. 10 attempts / 60s / IP.
    const ip = getClientIp(req);
    const rl = await enforce(`login:${ip}`, 10, 60);
    if (!rl.ok) return generic;

    const body = await req.json().catch(() => null);
    const email = body?.email;
    const password = body?.password;
    if (typeof email !== "string" || typeof password !== "string") {
      return generic;
    }

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user) return generic;

    // Deactivated staff can't sign in (mirrors the old authorize() isActive
    // check). Sign back out so no cookie lingers.
    const [profile] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, data.user.id))
      .limit(1);
    if (!profile || !profile.isActive) {
      await supabase.auth.signOut();
      return generic;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("auth.login_failed", { requestId, error: serializeError(error) });
    return generic;
  }
}
