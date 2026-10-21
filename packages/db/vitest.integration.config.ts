import { defineConfig } from "vitest/config";

/**
 * Integration tests of the web queries against a throwaway Postgres (`TEST_DATABASE_URL`),
 * through the sync-domain harness. Without it every suite is skipped. Files share the database,
 * so they run one at a time.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["test/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    server: {
      deps: {
        inline: ["zod"]
      }
    }
  }
});
