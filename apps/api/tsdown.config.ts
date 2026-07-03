import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: "esm",
  platform: "node",
  clean: true,
  sourcemap: true,
  noExternal: [/@bomberoscr\/.*/],
  external: ["@takumi-rs/core"]
});
