import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/client";
import { sql } from "../../src/operators";
import { getSitemapIncidentMonths, getSitemapIncidentsByMonth } from "../../src/queries/sitemap";
import { getStationIncidentsPerDay } from "../../src/queries/stations";
import {
  getDailyIncidents,
  getDailyResponseTimes,
  getIncidentsByDayOfWeek,
  getIncidentsByHour,
  getIncidentsByHourRange,
  getYearRecap
} from "../../src/queries/stats";
import { dispatchedStations, dispatchedVehicles, incidents, stations } from "../../src/schema";
import { TEST_DATABASE_URL, type TestDatabase, openTestDatabase, resetDatabase } from "./harness";

const STATION = 9101;

/** 20:25 on Saturday 10 October in Costa Rica, already Sunday the 11th in UTC. */
const EVENING = new Date("2026-10-11T02:25:00.000Z");
/** 21:00 on 31 October in Costa Rica, 1 November in UTC. */
const END_OF_OCTOBER = new Date("2026-11-01T03:00:00.000Z");
/** 23:30 on 31 December 2026 in Costa Rica, 2027 in UTC. */
const NEW_YEARS_EVE = new Date("2027-01-01T05:30:00.000Z");
/** 00:30 on 1 January 2027 in Costa Rica. */
const NEW_YEAR = new Date("2027-01-01T06:30:00.000Z");

const REPORTED = [
  { id: 1, at: EVENING },
  { id: 2, at: END_OF_OCTOBER },
  { id: 3, at: NEW_YEARS_EVE },
  { id: 4, at: NEW_YEAR }
];

function incident(id: number, at: Date) {
  return {
    id,
    EEConsecutive: `${id}-2026`,
    address: "DIRECCION DE PRUEBA",
    incidentTimestamp: at,
    importantDetails: "",
    latitude: "9.9",
    longitude: "-84.1",
    // Open, so the sitemap lists them whatever their age.
    isOpen: true,
    modifiedAt: at
  };
}

/** A pool whose sessions run in a time zone, through the connection's startup options. */
function databaseInTimeZone(timeZone: string): TestDatabase {
  const url = new URL(TEST_DATABASE_URL as string);
  url.searchParams.set("options", `-c TimeZone=${timeZone}`);
  return createDatabase(url.toString());
}

describe.skipIf(!TEST_DATABASE_URL)("Costa Rica time buckets", () => {
  let setup: TestDatabase;

  beforeAll(async () => {
    setup = await openTestDatabase();
    await resetDatabase(setup);
    await setup.insert(stations).values({
      id: STATION,
      name: "ESTACION PRUEBA HORARIO",
      stationKey: `9-${STATION}`,
      latitude: "9.9",
      longitude: "-84.1"
    });
    await setup.insert(incidents).values(REPORTED.map((row) => incident(row.id, row.at)));
    await setup.insert(dispatchedStations).values(
      REPORTED.map((row) => ({
        id: row.id,
        incidentId: row.id,
        stationId: STATION,
        attentionOnFoot: false
      }))
    );
    await setup.insert(dispatchedVehicles).values(
      REPORTED.map((row) => ({
        id: row.id,
        incidentId: row.id,
        stationId: STATION,
        vehicleId: null,
        vehicleInternalNumber: "M-900",
        dispatchedTime: new Date(row.at.getTime() + 60_000),
        arrivalTime: new Date(row.at.getTime() + 60_000 + 300_000)
      }))
    );
  });
  afterAll(async () => {
    await setup?.$client.end();
  });

  describe.each(["UTC", "Asia/Tokyo", "America/Costa_Rica"])("in a %s session", (timeZone) => {
    let db: TestDatabase;

    beforeAll(() => {
      db = databaseInTimeZone(timeZone);
    });
    afterAll(async () => {
      await db?.$client.end();
    });

    it("runs in that time zone, where a bare DATE() follows the session", async () => {
      const shown = await db.execute<{ TimeZone: string }>(sql`show timezone`);
      expect(shown.rows[0]?.TimeZone).toBe(timeZone);
      const bare = await db.execute<{ day: string }>(
        sql`select to_char(date(${incidents.incidentTimestamp}), 'YYYY-MM-DD') as day from ${incidents} where ${incidents.id} = 1`
      );
      expect(bare.rows[0]?.day).toBe(
        timeZone === "America/Costa_Rica" ? "2026-10-10" : "2026-10-11"
      );
    });

    it("counts the evening incident on 10 October at 20:00, a Saturday", async () => {
      const day = { startDate: new Date("2026-10-10T06:00:00Z"), endDate: EVENING };
      expect((await getDailyIncidents(day, db)).data).toMatchObject([
        { date: "2026-10-10", current: 1 }
      ]);
      expect(await getDailyResponseTimes(day, db)).toEqual([
        { date: "2026-10-10", averageResponseTimeSeconds: 300, dispatchCount: 1 }
      ]);

      const hours = await getIncidentsByHour(day, db);
      expect(hours.filter((row) => row.count > 0)).toEqual([
        { hour: 20, count: 1, displayHour: "20:00" }
      ]);

      const range = await getIncidentsByHourRange(
        { startDate: new Date("2026-10-11T01:00:00Z"), endDate: new Date("2026-10-11T03:10:00Z") },
        db
      );
      expect(range).toEqual([
        { hourStart: "2026-10-11T01:00:00.000Z", hourLabel: "19:00", hoursAgo: 2, incidents: 0 },
        { hourStart: "2026-10-11T02:00:00.000Z", hourLabel: "20:00", hoursAgo: 1, incidents: 1 },
        { hourStart: "2026-10-11T03:00:00.000Z", hourLabel: "21:00", hoursAgo: 0, incidents: 0 }
      ]);

      const weekdays = await getIncidentsByDayOfWeek(day, db);
      expect(weekdays.filter((row) => row.count > 0)).toEqual([{ dayOfWeek: "Sábado", count: 1 }]);
    });

    it("counts station days in Costa Rica time", async () => {
      const days = await getStationIncidentsPerDay(
        { stationId: STATION, days: 365, now: new Date("2027-01-02T12:00:00Z") },
        db
      );
      expect(days).toEqual([
        { date: "2026-10-10", count: 1 },
        { date: "2026-10-31", count: 1 },
        { date: "2026-12-31", count: 1 },
        { date: "2027-01-01", count: 1 }
      ]);
    });

    it("keeps 23:30 on 31 December in its Costa Rica year", async () => {
      const recap2026 = await getYearRecap(2026, db);
      expect(recap2026.topIncidentDays).toEqual([
        { date: "2026-12-31", count: 1 },
        { date: "2026-10-31", count: 1 },
        { date: "2026-10-10", count: 1 }
      ]);
      expect(recap2026.topDispatchedStations).toEqual([
        { name: "ESTACION PRUEBA HORARIO", count: 3 }
      ]);

      const recap2027 = await getYearRecap(2027, db);
      expect(recap2027.topIncidentDays).toEqual([{ date: "2027-01-01", count: 1 }]);
    });

    it("puts incidents in the sitemap month they were reported in Costa Rica", async () => {
      const months = await getSitemapIncidentMonths(db);
      expect(months.map((row) => row.month)).toEqual(["2027-01", "2026-12", "2026-10"]);

      const ids = async (yearMonth: string) =>
        (await getSitemapIncidentsByMonth(yearMonth, db)).map((row) => row.id).sort();
      expect(await ids("2026-10")).toEqual([1, 2]);
      expect(await ids("2026-11")).toEqual([]);
      expect(await ids("2026-12")).toEqual([3]);
      expect(await ids("2027-01")).toEqual([4]);
    });
  });
});
