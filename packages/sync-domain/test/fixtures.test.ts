import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FIXTURES_DIR, listScenarios, runScenario } from "./fixture-runner";

/** `UPDATE_FIXTURES=1` rewrites `expected.json`; review the diff before committing it. */
const update = process.env.UPDATE_FIXTURES === "1";

describe("fixtures", () => {
  const scenarios = listScenarios();

  it("has scenarios", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  for (const scenario of scenarios) {
    it(`${scenario} matches expected.json`, () => {
      const outcome = runScenario(scenario);
      const expectedPath = join(FIXTURES_DIR, scenario, "expected.json");
      if (update) {
        writeFileSync(expectedPath, `${JSON.stringify(outcome, null, 2)}\n`);
      }
      expect(existsSync(expectedPath)).toBe(true);
      expect(outcome).toEqual(JSON.parse(readFileSync(expectedPath, "utf8")));
    });
  }
});
