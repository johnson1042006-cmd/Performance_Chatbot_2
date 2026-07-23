import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // DDL needs the session pooler (DIRECT_URL); the runtime transaction
    // pooler (DATABASE_URL) is a fallback for environments without it.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
});
