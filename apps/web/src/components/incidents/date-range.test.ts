import { calendarDateFromKey, getCalendarDateKey } from "@bomberoscr/lib/costa-rica-time";
import { describe, expect, it } from "vitest";

import {
  fromIncidentsSearchDate,
  getDefaultIncidentsDateRange,
  getDefaultIncidentsSearchRange,
  toIncidentsSearchRange
} from "@/components/incidents/date-range";

function day(key: string): Date {
  const date = calendarDateFromKey(key);
  if (!date) throw new Error(`not a date key: ${key}`);
  return date;
}

describe("incident date filters", () => {
  it("search whole days from Costa Rica midnight to the last millisecond", () => {
    expect(toIncidentsSearchRange(day("2026-10-10"), day("2026-10-10"))).toEqual({
      start: "2026-10-10T06:00:00.000Z",
      end: "2026-10-11T05:59:59.999Z"
    });
    expect(toIncidentsSearchRange(day("2026-12-25"), day("2026-12-31"))).toEqual({
      start: "2026-12-25T06:00:00.000Z",
      end: "2027-01-01T05:59:59.999Z"
    });
  });

  it("default to the last 7 days up to today in Costa Rica", () => {
    // 20:25 on 10 October in Costa Rica, already the 11th in UTC.
    const now = new Date("2026-10-11T02:25:19.000Z");
    expect(getDefaultIncidentsSearchRange(now)).toEqual({
      start: "2026-10-04T06:00:00.000Z",
      end: "2026-10-11T05:59:59.999Z"
    });
    const range = getDefaultIncidentsDateRange(day("2026-10-10"));
    expect([getCalendarDateKey(range.from), getCalendarDateKey(range.to)]).toEqual([
      "2026-10-04",
      "2026-10-10"
    ]);
  });

  it("show a searched range as the Costa Rica days it covers", () => {
    const start = fromIncidentsSearchDate("2026-10-10T06:00:00.000Z");
    const end = fromIncidentsSearchDate("2026-10-11T05:59:59.999Z");
    expect(start && getCalendarDateKey(start)).toBe("2026-10-10");
    expect(end && getCalendarDateKey(end)).toBe("2026-10-10");
    expect(fromIncidentsSearchDate("2026-10-10T00:00:00-06:00")).toEqual(start);
    expect(fromIncidentsSearchDate(undefined)).toBeUndefined();
    expect(fromIncidentsSearchDate("not a date")).toBeUndefined();
  });
});
