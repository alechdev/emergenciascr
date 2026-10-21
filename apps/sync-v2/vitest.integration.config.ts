import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration tests against a throwaway Postgres and Redis (`TEST_DATABASE_URL`,
 * `TEST_REDIS_URL`). Without both every suite is skipped. Files share both servers, so they
 * run one at a time.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["test/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
