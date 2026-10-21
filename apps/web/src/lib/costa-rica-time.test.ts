import {
  calendarDateFromKey,
  costaRicaInstant,
  endOfCostaRicaDay,
  formatCostaRicaDate,
  getCalendarDateKey,
  getCostaRicaCalendarToday,
  getCostaRicaDateKey,
  getCostaRicaDateParts,
  getCostaRicaYear,
  isSameCostaRicaDay,
  startOfCostaRicaDay,
  startOfCostaRicaHour,
  startOfCostaRicaMonth,
  startOfCostaRicaYear
} from "@bomberoscr/lib/costa-rica-time";
import { describe, expect, it } from "vitest";

import { buildIncidentDescription } from "@/lib/incident-description";

// Incident 1923918 was reported at 20:25:19 on 10 October in Costa Rica: the 11th in UTC.
const EVENING = "2026-10-11T02:25:19.000Z";

describe("formatCostaRicaDate", () => {
  it("formats the evening incident on 10 October at 20:25", () => {
    expect(formatCostaRicaDate(EVENING, "longDate")).toBe("10 de octubre de 2026");
    expect(formatCostaRicaDate(EVENING, "time")).toBe("8:25 p. m.");
    expect(formatCostaRicaDate(EVENING, "paddedTime")).toBe("08:25 p. m.");
    expect(formatCostaRicaDate(EVENING, "longDateTime")).toBe(
      "10 de octubre de 2026 a las 8:25 p. m."
    );
    expect(formatCostaRicaDate(EVENING, "longDatePaddedTime")).toBe(
      "10 de octubre de 2026 a las 08:25 p. m."
    );
    expect(formatCostaRicaDate(EVENING, "shortDateTime")).toBe("10 oct 2026, 08:25 p. m.");
    expect(formatCostaRicaDate(EVENING, "dayMonth")).toBe("10 oct");
    expect(formatCostaRicaDate(EVENING, "dayMonthYear")).toBe("10 de octubre de 2026");
    expect(formatCostaRicaDate(EVENING, "weekdayDayMonth")).toBe("sábado, 10 de octubre");
  });

  it("takes dates, ISO strings and epoch milliseconds", () => {
    const expected = "10 de octubre de 2026";
    expect(formatCostaRicaDate(new Date(EVENING), "longDate")).toBe(expected);
    expect(formatCostaRicaDate(Date.parse(EVENING), "longDate")).toBe(expected);
  });

  it("gives an empty string for an invalid date instead of throwing", () => {
    expect(formatCostaRicaDate("", "time")).toBe("");
    expect(formatCostaRicaDate("not a date", "longDate")).toBe("");
  });

  it("keeps Costa Rica time with explicit options and another locale", () => {
    expect(formatCostaRicaDate(EVENING, { hour: "numeric", hourCycle: "h23" })).toBe("20");
    expect(formatCostaRicaDate(EVENING, { month: "short", day: "numeric" }, "en-US")).toBe(
      "Oct 10"
    );
  });
});

describe("Costa Rica calendar", () => {
  it("reads the wall-clock fields and the date key of an instant", () => {
    expect(getCostaRicaDateParts(EVENING)).toEqual({
      year: 2026,
      month: 10,
      day: 10,
      hour: 20,
      minute: 25,
      second: 19
    });
    expect(getCostaRicaDateKey(EVENING)).toBe("2026-10-10");
    expect(isSameCostaRicaDay(EVENING, "2026-10-10T06:00:00.000Z")).toBe(true);
    expect(isSameCostaRicaDay(EVENING, "2026-10-11T06:00:00.000Z")).toBe(false);
  });

  it("reads the year in Costa Rica, so 31 December at 23:30 is still that year", () => {
    const newYearsEve = "2027-01-01T05:30:00.000Z";
    expect(getCostaRicaYear(newYearsEve)).toBe(2026);
    expect(getCostaRicaYear("2027-01-01T06:00:00.000Z")).toBe(2027);
  });

  it("starts and ends days, hours, months and years at Costa Rica midnight", () => {
    expect(startOfCostaRicaDay(EVENING).toISOString()).toBe("2026-10-10T06:00:00.000Z");
    expect(endOfCostaRicaDay(EVENING).toISOString()).toBe("2026-10-11T05:59:59.999Z");
    expect(startOfCostaRicaDay(EVENING, -6).toISOString()).toBe("2026-10-04T06:00:00.000Z");
    expect(startOfCostaRicaHour(EVENING).toISOString()).toBe("2026-10-11T02:00:00.000Z");
    expect(startOfCostaRicaYear(2026).toISOString()).toBe("2026-01-01T06:00:00.000Z");
    expect(startOfCostaRicaMonth(2026, 13).toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });

  it("reads a YYYY-MM-DD key as a Costa Rica day, not UTC midnight", () => {
    expect(startOfCostaRicaDay("2026-10-10").toISOString()).toBe("2026-10-10T06:00:00.000Z");
    expect(endOfCostaRicaDay("2026-10-10").toISOString()).toBe("2026-10-11T05:59:59.999Z");
  });

  it("converts wall-clock times with the zone's rules, including Costa Rica's old DST", () => {
    expect(costaRicaInstant(2026, 10, 10, 20, 25, 19).toISOString()).toBe(EVENING);
    expect(costaRicaInstant(2026, 1, 0).toISOString()).toBe("2025-12-31T06:00:00.000Z");
    // Costa Rica was on UTC-5 from January to July 1992.
    expect(costaRicaInstant(1992, 3, 1).toISOString()).toBe("1992-03-01T05:00:00.000Z");
  });

  it("moves a wall-clock time skipped by DST forward, so the day still starts on that day", () => {
    // Clocks went from 00:00 to 01:00 on 25 February 1979.
    expect(startOfCostaRicaDay("1979-02-25").toISOString()).toBe("1979-02-25T06:00:00.000Z");
    expect(getCostaRicaDateKey(startOfCostaRicaDay("1979-02-25"))).toBe("1979-02-25");
    expect(costaRicaInstant(1979, 2, 25, 0, 30).toISOString()).toBe("1979-02-25T06:30:00.000Z");
    expect(startOfCostaRicaDay("1979-02-24").toISOString()).toBe("1979-02-24T06:00:00.000Z");
    expect(startOfCostaRicaDay("1979-02-26").toISOString()).toBe("1979-02-26T05:00:00.000Z");
  });

  it("keeps calendar days for date pickers as local dates of the same day", () => {
    const day = calendarDateFromKey("2026-10-10");
    expect(day && getCalendarDateKey(day)).toBe("2026-10-10");
    expect(calendarDateFromKey("10/10/2026")).toBeNull();
    expect(getCalendarDateKey(getCostaRicaCalendarToday(EVENING))).toBe("2026-10-10");
  });
});

describe("buildIncidentDescription", () => {
  it("says the incident was reported on the Costa Rica date", () => {
    const description = buildIncidentDescription(
      { incidentTimestamp: EVENING, address: "SAN JOSE, CENTRAL", EEConsecutive: "1-2026" },
      [{ vehicles: [{}, {}] }, { vehicles: [{}] }]
    );
    expect(description).toBe(
      "Incidente reportado el 10 de octubre de 2026 en SAN JOSE, CENTRAL. EE-1-2026. 2 estación(es) y 3 unidad(es) despachadas."
    );
  });

  it("leaves out a missing address", () => {
    expect(
      buildIncidentDescription(
        { incidentTimestamp: EVENING, address: "", EEConsecutive: "1-2026" },
        []
      )
    ).toBe(
      "Incidente reportado el 10 de octubre de 2026. EE-1-2026. 0 estación(es) y 0 unidad(es) despachadas."
    );
  });
});
