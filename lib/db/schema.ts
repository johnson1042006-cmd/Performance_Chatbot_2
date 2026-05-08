import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  decimal,
  index,
  serial,
  pgEnum,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", [
  "store_manager",
  "support_agent",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "waiting",
  "active_human",
  "active_ai",
  "closed",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "customer",
  "agent",
  "ai",
]);

export const pairingTypeEnum = pgEnum("pairing_type", [
  "matching_pants",
  "matching_jacket",
  "accessory",
  "frequently_bought",
]);

export const claimKindEnum = pgEnum("claim_kind", ["ai", "human"]);

export const chatEventTypeEnum = pgEnum("chat_event_type", [
  "claimed_by_human",
  "claimed_by_ai",
  "released_to_queue",
  "reassigned",
  "closed",
  "stale_closed",
  "tool_call",
  "auto_escalated",
  "internal_note",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: userRoleEnum("role").notNull().default("support_agent"),
  name: varchar("name", { length: 255 }).notNull(),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  // Forces a forced password change on next sign-in. Seeded users are flipped
  // to true so the default credentials can never persist into production.
  mustResetPassword: boolean("must_reset_password").notNull().default(false),
  passwordUpdatedAt: timestamp("password_updated_at"),
}, (table) => ({
  heartbeatIdx: index("users_heartbeat_idx").on(table.lastHeartbeatAt),
}));

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerIdentifier: varchar("customer_identifier", { length: 255 }).notNull(),
  pageContext: jsonb("page_context"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  claimedByUserId: uuid("claimed_by_user_id").references(() => users.id),
  claimedAt: timestamp("claimed_at"),
  status: sessionStatusEnum("status").notNull().default("waiting"),
  closedAt: timestamp("closed_at"),
  // Claim kind is the source of truth; status is kept in sync for backward compat
  claimedByKind: claimKindEnum("claimed_by_kind"),
  // When this timestamp is in the past and claimedByUserId IS NULL, the AI auto-claims
  aiClaimDueAt: timestamp("ai_claim_due_at"),
  // Used to detect stale/abandoned customer sessions
  lastCustomerActivityAt: timestamp("last_customer_activity_at").defaultNow().notNull(),
  // Heartbeat from the embed widget while the tab is open
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  // Captured via the contact-capture flow (chip "Talk to a human" / transcript email).
  // Mirrored on the session for fast manager-side lookups; canonical record lives
  // in customer_contacts (one session may have multiple contact captures over time).
  customerEmail: varchar("customer_email", { length: 255 }),
  customerName: varchar("customer_name", { length: 255 }),
  // Phase 4: Vercel-derived IP geolocation captured at session creation. All
  // three are nullable — populated only when the platform exposes the
  // x-vercel-ip-* headers (production / preview), null in local dev. Agent-
  // only context: never passed to buildPrompt or any AI tool.
  customerCity: varchar("customer_city", { length: 80 }),
  customerRegion: varchar("customer_region", { length: 80 }),
  customerCountry: varchar("customer_country", { length: 80 }),
}, (table) => ({
  aiClaimDueIdx: index("sessions_ai_claim_due_idx").on(table.aiClaimDueAt),
  customerIdentifierIdx: index("sessions_customer_identifier_idx").on(table.customerIdentifier),
  statusIdx: index("sessions_status_idx").on(table.status),
  heartbeatIdx: index("sessions_heartbeat_idx").on(table.lastHeartbeatAt),
  activityIdx: index("sessions_activity_idx").on(table.lastCustomerActivityAt),
}));

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  pageContext: jsonb("page_context"),
  // Categories of PII redacted from `content` (e.g. ["card", "email"]). Empty
  // for agent/AI messages and for clean customer messages.
  redactionHits: text("redaction_hits")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // Phase 3: heuristic confidence/sentiment computed at AI insert time.
  // Confidence is one of "high" | "medium" | "low"; sentiment is -1 | 0 | 1.
  // Both null for non-AI rows and for AI rows persisted before Phase 3.
  confidence: varchar("confidence", { length: 8 }),
  sentiment: integer("sentiment"),
}, (table) => ({
  sessionIdSentAtIdx: index("messages_session_id_sent_at_idx").on(table.sessionId, table.sentAt),
}));

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  bcProductId: integer("bc_product_id"),
  sku: varchar("sku", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 500 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }),
  category: varchar("category", { length: 255 }),
  colorTags: text("color_tags")
    .array()
    .default([]),
  isDiscontinued: boolean("is_discontinued").notNull().default(false),
  stockQty: integer("stock_qty").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const productPairings = pgTable("product_pairings", {
  id: uuid("id").defaultRandom().primaryKey(),
  primarySku: varchar("primary_sku", { length: 100 }).notNull(),
  pairedSku: varchar("paired_sku", { length: 100 }).notNull(),
  pairingType: pairingTypeEnum("pairing_type").notNull(),
});

export const knowledgeBase = pgTable("knowledge_base", {
  id: uuid("id").defaultRandom().primaryKey(),
  topic: varchar("topic", { length: 255 }).notNull().unique(),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const localCatalog = pgTable("local_catalog", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameLower: text("name_lower").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }),
  url: text("url"),
  bcProductId: integer("bc_product_id"),
});

export const productColorways = pgTable("product_colorways", {
  id: serial("id").primaryKey(),
  bcProductId: integer("bc_product_id").notNull(),
  productName: text("product_name").notNull(),
  category: text("category").notNull(),
  brand: text("brand"),
  colorway: text("colorway").notNull(),
  colorwayLower: text("colorway_lower").notNull(),
  baseSku: text("base_sku"),
  price: decimal("price", { precision: 10, scale: 2 }),
  url: text("url"),
}, (table) => ({
  bcProductIdIdx: index("product_colorways_bc_product_id_idx").on(table.bcProductId),
  colorwayLowerIdx: index("product_colorways_colorway_lower_idx").on(table.colorwayLower),
}));

export const chatEvents = pgTable("chat_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  type: chatEventTypeEnum("type").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  targetUserId: uuid("target_user_id").references(() => users.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  sessionIdIdx: index("chat_events_session_id_idx").on(table.sessionId),
  createdAtIdx: index("chat_events_created_at_idx").on(table.createdAt),
}));

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.key, table.windowStart] }),
    windowIdx: index("rate_limit_buckets_window_idx").on(table.windowStart),
  })
);

// Captures a customer's email (and optionally phone/name) for follow-up.
// Created via the embed contact-capture form ("Talk to a human" with no
// agents online, or the transcript-email button on the end-of-session card).
// `consent` is required true at the API layer; storing the bool gives us
// audit traceability if a customer later disputes communications.
export const customerContacts = pgTable(
  "customer_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    name: varchar("name", { length: 255 }),
    consent: boolean("consent").notNull().default(false),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    sessionIdIdx: index("customer_contacts_session_id_idx").on(table.sessionId),
    // Functional index on lower(email) so case-insensitive lookups match.
    emailLowerIdx: index("customer_contacts_email_lower_idx").on(
      sql`lower(${table.email})`
    ),
  })
);

// Customer-submitted CSAT for a session. Rating is a string ("up" | "down")
// rather than an enum so future ratings ("neutral", numeric, etc.) don't
// require a schema migration.
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    rating: varchar("rating", { length: 8 }).notNull(),
    comment: text("comment"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    sessionIdIdx: index("feedback_session_id_idx").on(table.sessionId),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Product = typeof products.$inferSelect;
export type ProductPairing = typeof productPairings.$inferSelect;
export type KnowledgeEntry = typeof knowledgeBase.$inferSelect;
export type LocalCatalogEntry = typeof localCatalog.$inferSelect;
export type ProductColorway = typeof productColorways.$inferSelect;
export type ChatEvent = typeof chatEvents.$inferSelect;
export type NewChatEvent = typeof chatEvents.$inferInsert;
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert;
export type CustomerContact = typeof customerContacts.$inferSelect;
export type NewCustomerContact = typeof customerContacts.$inferInsert;
export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;

// Phase 4: manager-authored canned replies surfaced to agents via a slash-
// command popover in the dashboard ChatPanel. Bodies support markdown and
// the placeholders {customer_name}, {agent_name}, {store_phone} which are
// substituted server-side at fetch time.
export const cannedResponses = pgTable(
  "canned_responses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 120 }).notNull(),
    body: text("body").notNull(),
    category: varchar("category", { length: 60 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    categoryIdx: index("canned_responses_category_idx").on(table.category),
  })
);

export type CannedResponse = typeof cannedResponses.$inferSelect;
export type NewCannedResponse = typeof cannedResponses.$inferInsert;
