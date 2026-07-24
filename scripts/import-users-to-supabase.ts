import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { createDb } from "../lib/db/connect";
import { users } from "../lib/db/schema";

/**
 * One-off migration: import every public.users row into Supabase auth.users,
 * PRESERVING the existing UUID and the existing bcrypt password hash.
 *
 * - Same id => all 9 FKs referencing users.id stay valid.
 * - password_hash imported verbatim => current passwords keep working.
 * - email_confirm: true => user is active with no email provider configured.
 *
 * Idempotent: skips users already present in auth.users (safe to re-run).
 * Safe to run BEFORE cutover — NextAuth ignores auth.users entirely.
 *
 * Run: npx tsx scripts/import-users-to-supabase.ts
 */
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local"
    );
  }

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { db, client } = createDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
    })
    .from(users);

  console.log(`Found ${rows.length} users in public.users\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    // Idempotency: skip if this auth user already exists.
    const existing = await admin.auth.admin.getUserById(row.id);
    if (existing.data?.user) {
      console.log(`SKIP  ${row.email} (already in auth.users)`);
      skipped++;
      continue;
    }

    const { error } = await admin.auth.admin.createUser({
      id: row.id,
      email: row.email,
      password_hash: row.passwordHash ?? undefined,
      email_confirm: true,
      user_metadata: { name: row.name ?? "" },
    });

    if (error) {
      console.error(`FAIL  ${row.email}: ${error.message}`);
      failed++;
    } else {
      console.log(`OK    ${row.email} (id preserved: ${row.id})`);
      created++;
    }
  }

  await client.end();

  console.log(
    `\nDone. created=${created} skipped=${skipped} failed=${failed}`
  );

  // Verify parity.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  console.log(`auth.users now contains ${list?.users.length ?? "?"} users.`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
