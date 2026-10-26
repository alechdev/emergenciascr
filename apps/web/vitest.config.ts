import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Separate from vite.config.ts so tests don't load the Start, React and Tailwind plugins.
export default defineConfig({
  resolve: {
    alias: {
      "@api": path.resolve(rootDir, "api"),
      "@": path.resolve(rootDir, "src")
    }
  },
  test: {
    environment: "node",
    include: ["api/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"]
  }
});
