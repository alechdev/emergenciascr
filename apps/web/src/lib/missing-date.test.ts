import { isKnownDate, isMissingDate } from "@bomberoscr/lib/missing-date";
import { afterEach, describe, expect, it } from "vitest";

const originalTz = process.env.TZ;

afterEach(() => {
  // Assigning undefined would set the literal string "undefined".
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("isMissingDate", () => {
  it("treats null, undefined, empty and unparsable values as missing", () => {
    for (const value of [null, undefined, "", "not a date", Number.NaN]) {
      expect(isMissingDate(value)).toBe(true);
      expect(isKnownDate(value)).toBe(false);
    }
  });

  it("treats SIGAE's 0001-01-01 placeholder as missing, with or without an offset", () => {
    for (const value of [
      "0001-01-01T00:00:00",
      "0001-01-01T00:00:00Z",
      new Date("0001-01-01T00:00:00.000Z")
    ]) {
      expect(isMissingDate(value)).toBe(true);
    }
  });

  it("treats the Unix epoch as missing", () => {
    for (const value of [0, new Date(0), "1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00"]) {
      expect(isMissingDate(value)).toBe(true);
    }
  });

  it("keeps real times, as dates, strings and timestamps", () => {
    const iso = "2026-10-11T02:25:19.000Z";
    for (const value of [iso, new Date(iso), new Date(iso).getTime()]) {
      expect(isMissingDate(value)).toBe(false);
      expect(isKnownDate(value)).toBe(true);
    }
  });

  it("doesn't depend on the local time zone", () => {
    // In Costa Rica the placeholder's local year is 0 and the epoch's is 1969.
    process.env.TZ = "America/Costa_Rica";
    expect(new Date("0001-01-01T00:00:00.000Z").getFullYear()).toBe(0);
    expect(isMissingDate(new Date("0001-01-01T00:00:00.000Z"))).toBe(true);
    expect(isMissingDate(new Date(0))).toBe(true);
    // 2026-01-01 00:30 in UTC is still 2025 in Costa Rica: a real time either way.
    expect(isMissingDate(new Date("2026-01-01T00:30:00.000Z"))).toBe(false);
  });
});
