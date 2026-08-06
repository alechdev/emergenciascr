import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const config = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    base: env.VITE_BASE ?? "/",
    resolve: {
      alias: {
        "@api": path.resolve(rootDir, "api"),
        "@": path.resolve(rootDir, "src")
      }
    },
    plugins: [
      viteTsConfigPaths({
        projects: ["./tsconfig.json"]
      }),
      devtools(),
      tanstackStart(),
      tailwindcss(),
      viteReact({
        babel: {
          plugins: ["babel-plugin-react-compiler"]
        }
      })
    ],
    server: {
      allowedHosts: true
    },
    ssr: {
      // Keep Hono + native deps out of Vite's browser optimize pass when SSR-loading /api.
      external: ["@takumi-rs/core", "pg", "pino", "pino-pretty"]
    }
  };
});

export default config;
