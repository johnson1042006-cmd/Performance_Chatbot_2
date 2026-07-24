-- Phase 2: Supabase Auth. APPLY AT CUTOVER ONLY — not before.
-- The FK below would break the still-live NextAuth invite flow, which inserts
-- public.users rows without a matching auth.users row. Run this in the same
-- window as the code deploy (after scripts/import-users-to-supabase.ts has
-- populated auth.users for the existing 5 users).

-- Credentials are owned by Supabase now; keep password_hash as a frozen
-- rollback lever (nullable). Drop the column in a later cleanup phase.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint

-- public.users.id is the SAME uuid as auth.users.id (see
-- scripts/import-users-to-supabase.ts). Deleting the Supabase auth identity
-- cascades away the profile row. auth.users is not a Drizzle-managed table, so
-- this constraint lives here rather than in lib/db/schema.ts.
ALTER TABLE "users"
  ADD CONSTRAINT "users_id_auth_fk"
  FOREIGN KEY ("id") REFERENCES auth.users("id") ON DELETE CASCADE;
