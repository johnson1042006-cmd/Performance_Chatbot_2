-- Phase 5: manager control plane
-- Adds full-text search on messages, AI tagger output on sessions, the FAQ
-- flag on knowledge_base, and the alert configuration + history tables.

-- 1) full-text search on messages
ALTER TABLE "messages"
  ADD COLUMN "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;--> statement-breakpoint
CREATE INDEX "messages_content_tsv_idx" ON "messages" USING GIN("content_tsv");--> statement-breakpoint

-- 2) AI tagger output on sessions
ALTER TABLE "sessions" ADD COLUMN "intent" varchar(40);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "topic_tags" text[] NOT NULL DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "resolved" boolean;--> statement-breakpoint
CREATE INDEX "sessions_intent_idx" ON "sessions" ("intent");--> statement-breakpoint

-- 3) FAQ flag on knowledge base — seeded rows stay is_faq=false (default).
ALTER TABLE "knowledge_base" ADD COLUMN "is_faq" boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE INDEX "knowledge_base_is_faq_idx" ON "knowledge_base" ("is_faq");--> statement-breakpoint

-- 4) alert configuration + history
CREATE TABLE "alert_thresholds" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind"          varchar(40) NOT NULL,
  "threshold"     numeric NOT NULL,
  "comparator"    varchar(2) NOT NULL,
  "enabled"       boolean NOT NULL DEFAULT true,
  "cooldown_min"  integer NOT NULL DEFAULT 30,
  "last_fired_at" timestamp with time zone,
  "metadata"      jsonb,
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "alert_thresholds_kind_idx" ON "alert_thresholds" ("kind");--> statement-breakpoint

CREATE TABLE "alert_events" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "threshold_id" uuid,
  "kind"         varchar(40) NOT NULL,
  "value"        numeric NOT NULL,
  "message"      text NOT NULL,
  "fired_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "acked_at"     timestamp with time zone,
  "acked_by"     uuid
);--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_threshold_id_fk" FOREIGN KEY ("threshold_id") REFERENCES "public"."alert_thresholds"("id") ON DELETE SET NULL ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_acked_by_users_id_fk" FOREIGN KEY ("acked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_fired_at_idx" ON "alert_events" ("fired_at" DESC);--> statement-breakpoint
CREATE INDEX "alert_events_unacked_idx"  ON "alert_events" ("acked_at") WHERE "acked_at" IS NULL;
