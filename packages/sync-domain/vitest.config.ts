import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    server: {
      deps: {
        // Under `bun --bun vitest`, externalized zod imports as an empty namespace.
        inline: ["zod"]
      }
    }
  }
});
