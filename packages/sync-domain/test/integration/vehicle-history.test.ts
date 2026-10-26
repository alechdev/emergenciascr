import { asc, eq, sql } from "@bomberoscr/db/operators";
import { vehicleStationHistory, vehicles } from "@bomberoscr/db/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { upsertVehicleDetails } from "../../src/persist/references";
import { syncIncident } from "../../src/pipeline/sync-incident";
import { INCIDENT_ID, detailsBody, listBody, reportBody, station, unit } from "../builders";
import {
  TEST_DATABASE_URL,
  type TestDatabase,
  openTestDatabase,
  pipelineHarness,
  resetDatabase,
  seedReferences,
  sigaeFixtureBody
} from "./harness";

import type { VehicleDetails } from "@bomberoscr/sigae/client";

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-10-16T12:00:00.000Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

/** Vehicle 860 (not seeded), at station 2 and operative unless overridden. */
function details(overrides: Record<string, unknown> = {}): VehicleDetails {
  return sigaeFixtureBody("ObtenerDatosVehiculo", {
    Id_vehiculo: 860,
    Numero_interno: "M-86",
    Id_estacion: 2,
    Des_estado_operativo: "OPERATIVO",
    ...overrides
  }) as unknown as VehicleDetails;
}

describe.skipIf(!TEST_DATABASE_URL)("vehicle_station_history", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.$client.end();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    await seedReferences(db);
  });

  async function history(vehicleId = 860) {
    const rows = await db
      .select()
      .from(vehicleStationHistory)
      .where(eq(vehicleStationHistory.vehicleId, vehicleId))
      .orderBy(asc(vehicleStationHistory.id));
    return rows.map(({ stationId, operationalStatus, firstSeenAt, lastSeenAt }) => ({
      stationId,
      operationalStatus,
      firstSeenAt,
      lastSeenAt
    }));
  }

  it("starts with the first observation and bumps lastSeenAt while nothing changes", async () => {
    await upsertVehicleDetails(db, 860, details(), at(0));
    expect(await history()).toEqual([
      { stationId: 2, operationalStatus: "OPERATIVO", firstSeenAt: at(0), lastSeenAt: at(0) }
    ]);

    await upsertVehicleDetails(db, 860, details(), at(12));
    await upsertVehicleDetails(db, 860, details(), at(24));
    expect(await history()).toEqual([
      { stationId: 2, operationalStatus: "OPERATIVO", firstSeenAt: at(0), lastSeenAt: at(24) }
    ]);
    // An older reading never moves it back.
    await upsertVehicleDetails(db, 860, details(), at(18));
    expect((await history())[0]?.lastSeenAt).toEqual(at(24));
  });

  it("starts a new row when the station or the status changes, and when it comes back", async () => {
    await upsertVehicleDetails(db, 860, details(), at(0));
    await upsertVehicleDetails(db, 860, details({ Id_estacion: 5 }), at(12));
    await upsertVehicleDetails(
      db,
      860,
      details({ Id_estacion: 5, Des_estado_operativo: "EN MANTENIMIENTO" }),
      at(24)
    );
    await upsertVehicleDetails(db, 860, details(), at(36));

    expect(await history()).toEqual([
      { stationId: 2, operationalStatus: "OPERATIVO", firstSeenAt: at(0), lastSeenAt: at(0) },
      { stationId: 5, operationalStatus: "OPERATIVO", firstSeenAt: at(12), lastSeenAt: at(12) },
      {
        stationId: 5,
        operationalStatus: "EN MANTENIMIENTO",
        firstSeenAt: at(24),
        lastSeenAt: at(24)
      },
      { stationId: 2, operationalStatus: "OPERATIVO", firstSeenAt: at(36), lastSeenAt: at(36) }
    ]);
    // `vehicles` only holds the current values.
    const [current] = await db.select().from(vehicles).where(eq(vehicles.id, 860));
    expect(current).toMatchObject({ stationId: 2, descriptionOperationalStatus: "OPERATIVO" });
  });

  it("keeps the stored status when SIGAE gives none", async () => {
    await upsertVehicleDetails(db, 860, details(), at(0));
    await upsertVehicleDetails(db, 860, details({ Des_estado_operativo: null }), at(12));

    expect(await history()).toEqual([
      { stationId: 2, operationalStatus: "OPERATIVO", firstSeenAt: at(0), lastSeenAt: at(12) }
    ]);
    // A vehicle SIGAE never gave a status for has none in its history.
    await upsertVehicleDetails(
      db,
      861,
      details({ Id_vehiculo: 861, Des_estado_operativo: null }),
      at(0)
    );
    expect(await history(861)).toEqual([
      { stationId: 2, operationalStatus: null, firstSeenAt: at(0), lastSeenAt: at(0) }
    ]);
  });

  it("starts the history of a vehicle stored before it existed", async () => {
    // Seeded vehicle 140 is M-12 at station 2, with no history.
    await upsertVehicleDetails(
      db,
      140,
      details({ Id_vehiculo: 140, Numero_interno: "M-12", Id_estacion: 5 }),
      at(0)
    );
    expect(await history(140)).toEqual([
      { stationId: 5, operationalStatus: "OPERATIVO", firstSeenAt: at(0), lastSeenAt: at(0) }
    ]);
  });

  it("records one row for concurrent observations of the same change", async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, index) => upsertVehicleDetails(db, 860, details(), at(index)))
    );
    expect(await history()).toEqual([
      expect.objectContaining({ stationId: 2, operationalStatus: "OPERATIVO", lastSeenAt: at(5) })
    ]);

    await Promise.all(
      Array.from({ length: 6 }, () =>
        upsertVehicleDetails(db, 860, details({ Id_estacion: 5 }), at(12))
      )
    );
    expect((await history()).map((row) => row.stationId)).toEqual([2, 5]);
  });

  it("rolls back the vehicle when the history write fails, and the reverse", async () => {
    await upsertVehicleDetails(db, 860, details(), at(0));
    await db.execute(sql`
      create or replace function integration_fail_insert() returns trigger
      language plpgsql as $$ begin raise exception 'injected failure'; end $$`);
    await db.execute(sql`
      create trigger integration_fail_history before insert on vehicle_station_history
      for each statement execute function integration_fail_insert()`);
    try {
      await expect(
        upsertVehicleDetails(db, 860, details({ Id_estacion: 5 }), at(12))
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger integration_fail_history on vehicle_station_history`);
      await db.execute(sql`drop function integration_fail_insert()`);
    }
    const [kept] = await db.select().from(vehicles).where(eq(vehicles.id, 860));
    expect(kept?.stationId).toBe(2);

    // A station that doesn't exist fails the upsert, and nothing reaches the history.
    await expect(
      upsertVehicleDetails(db, 860, details({ Id_estacion: 99 }), at(24))
    ).rejects.toThrow();
    expect(await history()).toEqual([
      { stationId: 2, operationalStatus: "OPERATIVO", firstSeenAt: at(0), lastSeenAt: at(0) }
    ]);
  });

  it("is written when a poll fetches an unknown vehicle on demand", async () => {
    const { deps, sigae, clock } = pipelineHarness(db, {
      references: {
        ObtenerDatosVehiculo: ({ params }) => ({
          body: sigaeFixtureBody("ObtenerDatosVehiculo", {
            Id_vehiculo: params.Id_Vehiculo,
            Numero_interno: "M-86",
            Id_estacion: 5
          })
        })
      }
    });
    sigae.answers = {
      ObtenerDetalleEmergencias: { body: detailsBody() },
      ObtenerBoletaIncidente: { body: reportBody() },
      ObtenerEstacionesAtiendeIncidente: { body: listBody([station()]) },
      ObtenerUnidadesDespachadasIncidente: {
        body: listBody([unit({ CodigoUnidad: 860, IdVehiculo: 860 })])
      }
    };

    const outcome = await syncIncident(deps, INCIDENT_ID);

    expect(outcome.references?.fetched.vehicles).toEqual([860]);
    expect(await history()).toEqual([
      {
        stationId: 5,
        operationalStatus: "OPERATIVO",
        firstSeenAt: clock.now(),
        lastSeenAt: clock.now()
      }
    ]);
  });
});
