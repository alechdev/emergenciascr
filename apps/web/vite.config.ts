import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const config = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    base: env.VITE_BASE ?? "/",
    plugins: [
      devtools(),
      tanstackStart(),
      viteTsConfigPaths({
        projects: ["./tsconfig.json"]
      }),
      tailwindcss(),
      viteReact({
        babel: {
          plugins: ["babel-plugin-react-compiler"]
        }
      })
    ],
    server: {
      allowedHosts: true
    }
  };
});

export default config;
