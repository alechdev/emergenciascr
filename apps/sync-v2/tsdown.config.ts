import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/adopt-legacy-open.ts"],
  format: "esm",
  platform: "node",
  clean: true,
  sourcemap: true,
  noExternal: [/@bomberoscr\/.*/]
});
