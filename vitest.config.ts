import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws when resolved under vitest's client condition.
      // Stub it so route modules that import lib/supabase/admin can load in
      // unit tests (the real guard still applies in the Next.js build).
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
