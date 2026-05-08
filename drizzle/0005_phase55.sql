-- Phase 5.5: ticketing system
-- Adds the tickets / ticket_comments / ticket_tags tables and extends
-- chat_event_type with the two ticket lifecycle values logged by
-- /api/tickets/[id] PATCH and the auto-ticket pipeline.

-- 1) extend the chat_event_type enum
ALTER TYPE "chat_event_type" ADD VALUE IF NOT EXISTS 'ticket_created';--> statement-breakpoint
ALTER TYPE "chat_event_type" ADD VALUE IF NOT EXISTS 'ticket_status_changed';--> statement-breakpoint

-- 2) tickets
CREATE TABLE "tickets" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_number"      serial NOT NULL UNIQUE,
  "session_id"         uuid,
  "subject"            varchar(200) NOT NULL,
  "description"        text,
  "status"             varchar(20) NOT NULL DEFAULT 'open',
  "priority"           varchar(10) NOT NULL DEFAULT 'normal',
  "category"           varchar(40),
  "source"             varchar(20) NOT NULL DEFAULT 'auto',
  "customer_email"     varchar(255),
  "customer_name"      varchar(255),
  "assigned_to"        uuid,
  "created_by"         uuid,
  "due_at"             timestamp with time zone,
  "first_response_at"  timestamp with time zone,
  "resolved_at"        timestamp with time zone,
  "closed_at"          timestamp with time zone,
  "sla_breached"       boolean NOT NULL DEFAULT false,
  "metadata"           jsonb,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"         timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tickets_status_check"   CHECK ("status"   IN ('open','pending','resolved','closed')),
  CONSTRAINT "tickets_priority_check" CHECK ("priority" IN ('urgent','high','normal','low')),
  CONSTRAINT "tickets_source_check"   CHECK ("source"   IN ('auto','manual','chat'))
);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE SET NULL ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_fk"  FOREIGN KEY ("created_by")  REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_status_priority_idx" ON "tickets" ("status","priority");--> statement-breakpoint
CREATE INDEX "tickets_due_at_idx"          ON "tickets" ("due_at");--> statement-breakpoint
CREATE INDEX "tickets_created_at_idx"      ON "tickets" ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "tickets_session_id_idx"      ON "tickets" ("session_id");--> statement-breakpoint
CREATE INDEX "tickets_assigned_to_idx"     ON "tickets" ("assigned_to");--> statement-breakpoint
CREATE INDEX "tickets_sla_breached_idx"    ON "tickets" ("sla_breached") WHERE "sla_breached" = true;--> statement-breakpoint

-- 3) ticket_comments
CREATE TABLE "ticket_comments" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id"   uuid NOT NULL,
  "author_id"   uuid,
  "body"        text NOT NULL,
  "is_internal" boolean NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE CASCADE ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id")  ON DELETE SET NULL ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_comments_ticket_id_idx" ON "ticket_comments" ("ticket_id","created_at");--> statement-breakpoint

-- 4) ticket_tags (composite PK on ticket_id + tag)
CREATE TABLE "ticket_tags" (
  "ticket_id" uuid NOT NULL,
  "tag"       varchar(40) NOT NULL,
  CONSTRAINT "ticket_tags_pk" PRIMARY KEY ("ticket_id","tag")
);--> statement-breakpoint
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE CASCADE ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_tags_tag_idx" ON "ticket_tags" ("tag");
