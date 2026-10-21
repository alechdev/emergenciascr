import { defineConfig } from "vitest/config";

/**
 * Integration tests against a throwaway Postgres (`TEST_DATABASE_URL`). Without it every suite
 * is skipped. Files share the database, so they run one at a time.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
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
