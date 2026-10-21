import { describe, expect, it, vi } from "vitest";

import { buildMapVersion, getS3Key, hasMapCoordinates } from "./map-utils";

vi.mock("@api/env", () => ({ default: {} }));

describe("buildMapVersion", () => {
  it("is the same for the same coordinates, however they are written", () => {
    expect(buildMapVersion("9.90", "-84.100")).toBe(buildMapVersion(9.9, -84.1));
    expect(buildMapVersion("9.9", "-84.1")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("changes when the coordinates move", () => {
    expect(buildMapVersion("9.9012", "-84.1009")).not.toBe(buildMapVersion("9.9", "-84.1"));
  });

  it("keys the stored image", () => {
    const version = buildMapVersion("9.9", "-84.1");
    expect(getS3Key(1925099, version)).toBe(`incidents/1925099/map/${version}.png`);
  });
});

describe("hasMapCoordinates", () => {
  it("treats a 0 coordinate as unknown", () => {
    expect(hasMapCoordinates("9.9", "-84.1")).toBe(true);
    expect(hasMapCoordinates("0", "0")).toBe(false);
    expect(hasMapCoordinates("9.9", "0")).toBe(false);
    expect(hasMapCoordinates("", "-84.1")).toBe(false);
  });
});
