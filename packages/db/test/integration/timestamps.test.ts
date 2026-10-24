import { isMissingDate } from "@bomberoscr/lib/missing-date";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/client";
import { eq, sql } from "../../src/operators";
import { dispatchedVehicles, incidents, stations } from "../../src/schema";
import { TEST_DATABASE_URL, type TestDatabase, openTestDatabase, resetDatabase } from "./harness";

const STATION = 9201;
const REPORTED = new Date("2026-10-11T02:25:00.000Z");
/** SIGAE's `0001-01-01T00:00:00` in Costa Rica local mean time, as the legacy sync stored it. */
const LEGACY_PLACEHOLDER = "0001-01-01T05:36:13.000Z";

function databaseInTimeZone(timeZone: string): TestDatabase {
  const url = new URL(TEST_DATABASE_URL as string);
  url.searchParams.set("options", `-c TimeZone=${timeZone}`);
  return createDatabase(url.toString());
}

describe.skipIf(!TEST_DATABASE_URL)("timestamptz columns", () => {
  let setup: TestDatabase;

  beforeAll(async () => {
    setup = await openTestDatabase();
    await resetDatabase(setup);
    await setup.insert(stations).values({
      id: STATION,
      name: "ESTACION PRUEBA FECHAS",
      stationKey: `9-${STATION}`,
      latitude: "9.9",
      longitude: "-84.1"
    });
    await setup.insert(incidents).values({
      id: 1,
      EEConsecutive: "1-2026",
      address: "DIRECCION DE PRUEBA",
      incidentTimestamp: REPORTED,
      importantDetails: "",
      latitude: "9.9",
      longitude: "-84.1",
      isOpen: false,
      modifiedAt: REPORTED
    });
    await setup.insert(dispatchedVehicles).values({
      id: 1,
      incidentId: 1,
      stationId: STATION,
      vehicleId: null,
      vehicleInternalNumber: "M-900",
      dispatchedTime: new Date(REPORTED.getTime() + 60_000),
      arrivalTime: new Date(LEGACY_PLACEHOLDER)
    });
    // Written as text, the way the legacy sync's rows reach a migrated database.
    await setup.execute(
      sql`update ${dispatchedVehicles} set "baseReturnTime" = '0001-01-01 05:36:13+00', "departureTime" = '2026-10-11 02:40:00.123456+00' where id = 1`
    );
  });
  afterAll(async () => {
    await setup?.$client.end();
  });

  describe.each(["UTC", "America/Costa_Rica"])("in a %s session", (timeZone) => {
    let db: TestDatabase;

    beforeAll(() => {
      db = databaseInTimeZone(timeZone);
    });
    afterAll(async () => {
      await db?.$client.end();
    });

    it("reads year 1 as year 1, not 2001", async () => {
      // In Costa Rica, Postgres sends year 1 with a local mean time offset: `-05:36:13`.
      const [row] = await db.select().from(dispatchedVehicles).where(eq(dispatchedVehicles.id, 1));
      expect(row?.arrivalTime?.toISOString()).toBe(LEGACY_PLACEHOLDER);
      expect(row?.baseReturnTime?.toISOString()).toBe(LEGACY_PLACEHOLDER);
      expect(isMissingDate(row?.baseReturnTime)).toBe(true);
    });

    it("keeps recent instants, truncating microseconds to milliseconds", async () => {
      const [row] = await db.select().from(dispatchedVehicles).where(eq(dispatchedVehicles.id, 1));
      expect(row?.dispatchedTime?.toISOString()).toBe("2026-10-11T02:26:00.000Z");
      expect(row?.departureTime?.toISOString()).toBe("2026-10-11T02:40:00.123Z");
    });

    it("reads the same values through relational queries", async () => {
      const incident = await db.query.incidents.findFirst({
        where: eq(incidents.id, 1),
        with: { dispatchedVehicles: true }
      });
      expect(incident?.incidentTimestamp.toISOString()).toBe(REPORTED.toISOString());
      expect(incident?.dispatchedVehicles[0]?.baseReturnTime?.toISOString()).toBe(
        LEGACY_PLACEHOLDER
      );
      expect(incident?.dispatchedVehicles[0]?.departureTime?.toISOString()).toBe(
        "2026-10-11T02:40:00.123Z"
      );
    });
  });
});
