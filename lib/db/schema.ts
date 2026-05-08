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
