import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getIncidentById } from "../../src/queries/incidents";
import { getStationVehiclesWithStats } from "../../src/queries/stations";
import { getYearRecap } from "../../src/queries/stats";
import { dispatchedVehicles, incidents, stations, vehicles } from "../../src/schema";
import { TEST_DATABASE_URL, type TestDatabase, openTestDatabase, resetDatabase } from "./harness";

// Mid-year, so the recap's year bounds hold in UTC and in Costa Rica time.
const NOW = new Date("2026-06-20T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const STATION_A = 9001;
const STATION_B = 9002;
/** Assigned to A until it moved to B. */
const MOVED = 7001;
const STAYED_AT_A = 7002;
const NEVER_DISPATCHED_AT_B = 7003;

function station(id: number, name: string) {
  return { id, name, stationKey: `9-${id}`, latitude: "9.9", longitude: "-84.1" };
}

function vehicle(id: number, internalNumber: string, stationId: number) {
  return {
    id,
    internalNumber,
    plate: `PRUEBA-${id}`,
    stationId,
    descriptionType: "UNIDAD DE PRUEBA",
    class: "EXTINCION",
    descriptionOperationalStatus: "DISPONIBLE"
  };
}

function incident(id: number, at: Date) {
  return {
    id,
    EEConsecutive: `${id}-2026`,
    address: "DIRECCION DE PRUEBA",
    incidentTimestamp: at,
    importantDetails: "",
    latitude: "9.9",
    longitude: "-84.1",
    isOpen: false,
    modifiedAt: at
  };
}

let nextDispatchId = 1;
function dispatch(
  incidentId: number,
  at: Date,
  stationId: number,
  vehicleId: number | null,
  responseSeconds: number
) {
  return {
    id: nextDispatchId++,
    incidentId,
    stationId,
    vehicleId,
    vehicleInternalNumber: vehicleId === null ? "M-799" : null,
    dispatchedTime: at,
    arrivalTime: new Date(at.getTime() + responseSeconds * 1000)
  };
}

describe.skipIf(!TEST_DATABASE_URL)("station views follow the station of each dispatch", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.$client.end();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    nextDispatchId = 1;
    await db
      .insert(stations)
      .values([station(STATION_A, "ESTACION PRUEBA A"), station(STATION_B, "ESTACION PRUEBA B")]);
    // The vehicle row only has the current station: the moved vehicle is at B now.
    await db
      .insert(vehicles)
      .values([
        vehicle(MOVED, "M-701", STATION_B),
        vehicle(STAYED_AT_A, "M-702", STATION_A),
        vehicle(NEVER_DISPATCHED_AT_B, "M-703", STATION_B)
      ]);
    const timeline = [
      { id: 1, at: daysAgo(110), station: STATION_A, vehicle: MOVED, seconds: 400 },
      { id: 2, at: daysAgo(19), station: STATION_A, vehicle: MOVED, seconds: 300 },
      { id: 3, at: daysAgo(15), station: STATION_A, vehicle: MOVED, seconds: 500 },
      { id: 4, at: daysAgo(10), station: STATION_A, vehicle: STAYED_AT_A, seconds: 360 },
      // Outside the 30-day window of the station list, inside the recap's year.
      { id: 5, at: daysAgo(80), station: STATION_B, vehicle: MOVED, seconds: 600 },
      { id: 6, at: daysAgo(5), station: STATION_B, vehicle: MOVED, seconds: 420 }
    ];
    await db.insert(incidents).values(timeline.map((row) => incident(row.id, row.at)));
    await db.insert(dispatchedVehicles).values([
      ...timeline.map((row) => dispatch(row.id, row.at, row.station, row.vehicle, row.seconds)),
      // A vehicle SIGAE doesn't know: no vehicle row to count it for.
      dispatch(6, daysAgo(5), STATION_B, null, 450)
    ]);
  });

  function stats(rows: Awaited<ReturnType<typeof getStationVehiclesWithStats>>) {
    return rows.map((row) => ({ id: row.id, ...row.stats }));
  }

  it("B's vehicle list shows the moved vehicle without A's dispatches", async () => {
    const rows = await getStationVehiclesWithStats({ stationId: STATION_B, now: NOW }, db);
    expect(stats(rows)).toEqual([
      { id: MOVED, incidentCount: 1, avgResponseTimeSeconds: 420 },
      { id: NEVER_DISPATCHED_AT_B, incidentCount: 0, avgResponseTimeSeconds: null }
    ]);
  });

  it("A's vehicle list only has the vehicles assigned to it now", async () => {
    const rows = await getStationVehiclesWithStats({ stationId: STATION_A, now: NOW }, db);
    expect(stats(rows)).toEqual([
      { id: STAYED_AT_A, incidentCount: 1, avgResponseTimeSeconds: 360 }
    ]);
  });

  it("only counts the last 30 days", async () => {
    const rows = await getStationVehiclesWithStats(
      { stationId: STATION_B, now: new Date(NOW.getTime() + 40 * DAY) },
      db
    );
    expect(stats(rows)).toEqual([
      { id: MOVED, incidentCount: 0, avgResponseTimeSeconds: null },
      { id: NEVER_DISPATCHED_AT_B, incidentCount: 0, avgResponseTimeSeconds: null }
    ]);
  });

  it("A's past incidents still show the moved vehicle under A", async () => {
    const past = await getIncidentById({ id: 2 }, db);
    expect(
      past?.dispatchedVehicles.map((row) => ({
        stationId: row.stationId,
        station: row.station.name,
        vehicle: row.vehicle?.internalNumber
      }))
    ).toEqual([{ stationId: STATION_A, station: "ESTACION PRUEBA A", vehicle: "M-701" }]);
  });

  it("the annual recap labels each vehicle with the station it served", async () => {
    const recap = await getYearRecap(2026, db);
    expect(recap.topDispatchedVehicles).toEqual([
      { internalNumber: "M-701", stationName: "ESTACION PRUEBA A", count: 3 },
      { internalNumber: "M-701", stationName: "ESTACION PRUEBA B", count: 2 },
      { internalNumber: "M-702", stationName: "ESTACION PRUEBA A", count: 1 }
    ]);
  });
});
