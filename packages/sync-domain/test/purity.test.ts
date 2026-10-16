import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const CORE = ["poll", "normalize", "reconcile", "lifecycle", "redact"];
const CORE_FILES = ["types.ts"];

/** Packages the core may load at runtime. None of them touch the database, Redis or env. */
const RUNTIME_IMPORTS = new Set(["@bomberoscr/sigae/dates", "neverthrow", "node:crypto"]);
/** Packages the core may only import types from. */
const TYPE_IMPORTS = new Set(["@bomberoscr/sigae/client"]);

function coreFiles(): string[] {
  const files = CORE_FILES.map((file) => join(SRC, file));
  for (const dir of CORE) {
    for (const entry of readdirSync(join(SRC, dir), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(join(entry.parentPath, entry.name));
      }
    }
  }
  return files;
}

function isInCore(path: string): boolean {
  const rel = relative(SRC, path);
  return CORE_FILES.includes(rel) || CORE.some((dir) => rel.startsWith(`${dir}/`));
}

/** Static `import … from`, `export … from` and side-effect `import "…"` declarations. */
function importsOf(source: string): { typeOnly: boolean; specifier: string }[] {
  const fromClauses = [
    ...source.matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)
  ].map((match) => ({ typeOnly: Boolean(match[1]), specifier: match[2] as string }));
  const sideEffects = [...source.matchAll(/^import\s+["']([^"']+)["']/gm)].map((match) => ({
    typeOnly: false,
    specifier: match[1] as string
  }));
  return [...fromClauses, ...sideEffects];
}

describe("the pure core", () => {
  it("finds every kind of import", () => {
    const source = [
      'import { a } from "./a";',
      'import type { B } from "b";',
      'import "@bomberoscr/db/index";',
      "import 'side-effect';",
      'export * from "./c";'
    ].join("\n");
    expect(importsOf(source)).toEqual([
      { typeOnly: false, specifier: "./a" },
      { typeOnly: true, specifier: "b" },
      { typeOnly: false, specifier: "./c" },
      { typeOnly: false, specifier: "@bomberoscr/db/index" },
      { typeOnly: false, specifier: "side-effect" }
    ]);
  });

  it("imports no database, Redis, BullMQ or env module", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
      const source = readFileSync(file, "utf8");
      const name = relative(SRC, file);
      for (const { typeOnly, specifier } of importsOf(source)) {
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(file), specifier);
          if (!isInCore(target.endsWith(".ts") ? target : `${target}.ts`)) {
            violations.push(`${name}: ${specifier} is outside the core`);
          }
        } else if (!RUNTIME_IMPORTS.has(specifier) && !(typeOnly && TYPE_IMPORTS.has(specifier))) {
          violations.push(`${name}: ${typeOnly ? "type " : ""}${specifier}`);
        }
      }
      if (/\bprocess\.env\b/.test(source)) violations.push(`${name}: reads process.env`);
      if (/\bimport\(/.test(source)) violations.push(`${name}: dynamic import`);
    }
    expect(violations).toEqual([]);
  });

  it("checks every core module", () => {
    expect(coreFiles().length).toBeGreaterThan(10);
  });
});
