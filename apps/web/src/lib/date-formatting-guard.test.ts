import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHARED_MODULE = "packages/lib/src/costa-rica-time.ts";
const SOURCE_DIRS = ["apps/web/src", "apps/web/api", "packages/db/src", "packages/lib/src"];

// These format in the runtime's zone unless given one; everything goes through the shared module.
const ZONE_DEPENDENT_FORMATTING = /\.toLocale(?:Date|Time)String\(|\bIntl\.DateTimeFormat\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.(?:gen|test)\.tsx?$/.test(file))
    .map((file) => path.posix.join(dir, file.split(path.sep).join("/")));
}

describe("date formatting", () => {
  it("formats dates only through the Costa Rica time module", () => {
    const offenders = SOURCE_DIRS.flatMap(sourceFiles)
      .filter((file) => file !== SHARED_MODULE)
      .flatMap((file) =>
        readFileSync(path.join(repoRoot, file), "utf8")
          .split("\n")
          .flatMap((line, index) =>
            ZONE_DEPENDENT_FORMATTING.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : []
          )
      );

    expect(offenders).toEqual([]);
  });
});
