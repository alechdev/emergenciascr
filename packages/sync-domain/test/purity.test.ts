import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url).pathname;
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

describe("the pure core", () => {
  it("imports no database, Redis, BullMQ or env module", () => {
    const violations: string[] = [];
    for (const file of coreFiles()) {
      const source = readFileSync(file, "utf8");
      const name = relative(SRC, file);
      for (const match of source.matchAll(
        /^(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm
      )) {
        const typeOnly = Boolean(match[2]);
        const specifier = match[3] as string;
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
