CREATE TYPE "public"."chat_event_type" AS ENUM('claimed_by_human', 'claimed_by_ai', 'released_to_queue', 'reassigned', 'closed', 'stale_closed');--> statement-breakpoint
CREATE TYPE "public"."claim_kind" AS ENUM('ai', 'human');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('customer', 'agent', 'ai');--> statement-breakpoint
CREATE TYPE "public"."pairing_type" AS ENUM('matching_pants', 'matching_jacket', 'accessory', 'frequently_bought');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('waiting', 'active_human', 'active_ai', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('store_manager', 'support_agent');--> statement-breakpoint
CREATE TABLE "chat_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"type" "chat_event_type" NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_base" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_base_topic_unique" UNIQUE("topic")
);
--> statement-breakpoint
CREATE TABLE "local_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_lower" text NOT NULL,
	"price" numeric(10, 2),
	"url" text,
	"bc_product_id" integer
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"page_context" jsonb,
	"redaction_hits" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_colorways" (
	"id" serial PRIMARY KEY NOT NULL,
	"bc_product_id" integer NOT NULL,
	"product_name" text NOT NULL,
	"category" text NOT NULL,
	"brand" text,
	"colorway" text NOT NULL,
	"colorway_lower" text NOT NULL,
	"base_sku" text,
	"price" numeric(10, 2),
	"url" text
);
--> statement-breakpoint
CREATE TABLE "product_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"primary_sku" varchar(100) NOT NULL,
	"paired_sku" varchar(100) NOT NULL,
	"pairing_type" "pairing_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bc_product_id" integer,
	"sku" varchar(100) NOT NULL,
	"name" varchar(500) NOT NULL,
	"description" text,
	"price" numeric(10, 2),
	"category" varchar(255),
	"color_tags" text[] DEFAULT '{}',
	"is_discontinued" boolean DEFAULT false NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_buckets_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_identifier" varchar(255) NOT NULL,
	"page_context" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp,
	"status" "session_status" DEFAULT 'waiting' NOT NULL,
	"closed_at" timestamp,
	"claimed_by_kind" "claim_kind",
	"ai_claim_due_at" timestamp,
	"last_customer_activity_at" timestamp DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'support_agent' NOT NULL,
	"name" varchar(255) NOT NULL,
	"avatar_url" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp,
	"must_reset_password" boolean DEFAULT false NOT NULL,
	"password_updated_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "chat_events" ADD CONSTRAINT "chat_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_events" ADD CONSTRAINT "chat_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_events" ADD CONSTRAINT "chat_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_events_session_id_idx" ON "chat_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "chat_events_created_at_idx" ON "chat_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_session_id_sent_at_idx" ON "messages" USING btree ("session_id","sent_at");--> statement-breakpoint
CREATE INDEX "product_colorways_bc_product_id_idx" ON "product_colorways" USING btree ("bc_product_id");--> statement-breakpoint
CREATE INDEX "product_colorways_colorway_lower_idx" ON "product_colorways" USING btree ("colorway_lower");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_window_idx" ON "rate_limit_buckets" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "sessions_ai_claim_due_idx" ON "sessions" USING btree ("ai_claim_due_at");--> statement-breakpoint
CREATE INDEX "sessions_customer_identifier_idx" ON "sessions" USING btree ("customer_identifier");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_heartbeat_idx" ON "sessions" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "sessions_activity_idx" ON "sessions" USING btree ("last_customer_activity_at");--> statement-breakpoint
CREATE INDEX "users_heartbeat_idx" ON "users" USING btree ("last_heartbeat_at");