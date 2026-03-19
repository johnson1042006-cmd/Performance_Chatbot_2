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
  pgEnum,
} from "drizzle-orm/pg-core";

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
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerIdentifier: varchar("customer_identifier", { length: 255 }).notNull(),
  pageContext: jsonb("page_context"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  claimedByUserId: uuid("claimed_by_user_id").references(() => users.id),
  claimedAt: timestamp("claimed_at"),
  status: sessionStatusEnum("status").notNull().default("waiting"),
  closedAt: timestamp("closed_at"),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  pageContext: jsonb("page_context"),
});

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Product = typeof products.$inferSelect;
export type ProductPairing = typeof productPairings.$inferSelect;
export type KnowledgeEntry = typeof knowledgeBase.$inferSelect;
