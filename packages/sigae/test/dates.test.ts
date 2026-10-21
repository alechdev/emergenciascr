import { describe, expect, test } from "vitest";

import {
  SIGAE_MISSING_DATE,
  formatSigaeRequestDate,
  isSigaeDateString,
  parseSigaeDate
} from "../src/client/dates";

describe("parseSigaeDate", () => {
  test("reads SIGAE strings as Costa Rica time (UTC-6)", () => {
    expect(parseSigaeDate("2026-10-10T20:25:19")?.toISOString()).toBe("2026-10-11T02:25:19.000Z");
    expect(parseSigaeDate("2026-01-01T00:00:00")?.toISOString()).toBe("2026-01-01T06:00:00.000Z");
  });

  test("gives the same instant whatever the process timezone", () => {
    // The suite runs under TZ=UTC and TZ=America/Costa_Rica; the expected values are fixed.
    expect(parseSigaeDate("2026-07-15T23:59:59")?.getTime()).toBe(Date.UTC(2026, 6, 16, 5, 59, 59));
  });

  test("keeps fractional seconds up to milliseconds", () => {
    expect(parseSigaeDate("2026-10-10T21:30:00.1270000")?.toISOString()).toBe(
      "2026-10-11T03:30:00.127Z"
    );
    expect(parseSigaeDate("2026-10-10T21:30:00.5")?.toISOString()).toBe("2026-10-11T03:30:00.500Z");
  });

  test("returns null for the missing-date placeholder and empty values", () => {
    expect(parseSigaeDate(SIGAE_MISSING_DATE)).toBeNull();
    expect(parseSigaeDate("0001-01-01T00:00:00")).toBeNull();
    expect(parseSigaeDate(null)).toBeNull();
    expect(parseSigaeDate(undefined)).toBeNull();
    expect(parseSigaeDate("")).toBeNull();
  });

  test("returns other early dates as-is so the caller can flag them", () => {
    expect(parseSigaeDate("1900-01-01T00:00:00")?.toISOString()).toBe("1900-01-01T06:00:00.000Z");
    expect(parseSigaeDate("0050-03-01T00:00:00")?.getUTCFullYear()).toBe(50);
  });

  test("returns null for strings that are not SIGAE dates", () => {
    for (const raw of [
      "2026-10-10T20:25:19Z",
      "2026-10-10T20:25:19-06:00",
      "2026-10-10",
      "10/10/2026 20:25:19",
      "2026-02-30T10:00:00",
      "2026-10-10T24:00:00",
      "not a date"
    ]) {
      expect(parseSigaeDate(raw), raw).toBeNull();
      expect(isSigaeDateString(raw), raw).toBe(false);
    }
  });

  test("recognizes SIGAE date strings", () => {
    expect(isSigaeDateString("2026-10-10T20:25:19")).toBe(true);
    expect(isSigaeDateString(SIGAE_MISSING_DATE)).toBe(true);
    expect(isSigaeDateString(20261010)).toBe(false);
  });
});

describe("formatSigaeRequestDate", () => {
  test("uses the Costa Rica calendar date", () => {
    // 20:25 on 10 October in Costa Rica is already 11 October in UTC.
    expect(formatSigaeRequestDate(new Date("2026-10-11T02:25:19Z"))).toBe("2026-10-10");
    expect(formatSigaeRequestDate(new Date("2026-10-11T05:59:59.999Z"))).toBe("2026-10-10");
    expect(formatSigaeRequestDate(new Date("2026-10-11T06:00:00Z"))).toBe("2026-10-11");
    expect(formatSigaeRequestDate(new Date("2026-01-01T03:00:00Z"))).toBe("2025-12-31");
  });

  test("rejects invalid dates", () => {
    expect(() => formatSigaeRequestDate(new Date("nope"))).toThrow(RangeError);
  });
});
