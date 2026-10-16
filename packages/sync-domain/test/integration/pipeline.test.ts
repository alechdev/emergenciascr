import { eq, sql } from "@bomberoscr/db/operators";
import {
  dispatchedStations,
  dispatchedVehicles,
  incidentSyncState,
  incidents,
  stations,
  vehicles
} from "@bomberoscr/db/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSyncState, saveSyncState } from "../../src/persist/incident-state";
import { createReferenceResolver } from "../../src/pipeline/references";
import { syncIncident } from "../../src/pipeline/sync-incident";
import {
  CAST_ERROR,
  INCIDENT_ID,
  NOT_FOUND,
  OK,
  detailsBody,
  listBody,
  reportBody,
  station,
  syncState,
  unit
} from "../builders";
import {
  type IncidentAnswers,
  TEST_DATABASE_URL,
  type TestDatabase,
  fakeClock,
  fakeSigae,
  loadHistory,
  openTestDatabase,
  pipelineHarness,
  replayScenario,
  resetDatabase,
  seedReferences,
  sigaeFixtureBody
} from "./harness";

const MINUTE = 60_000;

function answers(
  input: {
    details?: unknown;
    report?: unknown;
    stations?: unknown[];
    units?: unknown[];
  } = {}
): IncidentAnswers {
  return {
    ObtenerDetalleEmergencias: { body: input.details ?? detailsBody() },
    ObtenerBoletaIncidente: { body: input.report ?? reportBody() },
    ObtenerEstacionesAtiendeIncidente: {
      body: listBody((input.stations ?? [station()]) as Record<string, unknown>[])
    },
    ObtenerUnidadesDespachadasIncidente: {
      body: listBody((input.units ?? [unit()]) as Record<string, unknown>[])
    }
  };
}

const NOT_FOUND_ANSWERS: IncidentAnswers = {
  ObtenerDetalleEmergencias: { body: { ...detailsBody(), ...NOT_FOUND } },
  ObtenerBoletaIncidente: { body: { ...reportBody(), ...NOT_FOUND } },
  ObtenerEstacionesAtiendeIncidente: { body: listBody([], NOT_FOUND) },
  ObtenerUnidadesDespachadasIncidente: { body: listBody([], NOT_FOUND) }
};

describe.skipIf(!TEST_DATABASE_URL)("syncIncident against Postgres", () => {
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

  describe("transactions", () => {
    it("leaves no partial incident, children or changes when a write fails", async () => {
      const { deps, sigae, clock } = pipelineHarness(db);
      sigae.answers = answers();
      await db.execute(sql`
        create or replace function integration_fail_insert() returns trigger
        language plpgsql as $$ begin raise exception 'injected failure'; end $$`);
      await db.execute(sql`
        create trigger integration_fail_changes before insert on incident_changes
        for each statement execute function integration_fail_insert()`);
      try {
        const outcome = await syncIncident(deps, INCIDENT_ID);

        expect(outcome.kind).toBe("failed");
        expect(outcome.reason).toMatch(/^internal error: .*injected failure/);
        // The redacted message keeps no row values.
        expect(outcome.reason).not.toContain("SINTETICA");
      } finally {
        await db.execute(sql`drop trigger integration_fail_changes on incident_changes`);
        await db.execute(sql`drop function integration_fail_insert()`);
      }

      expect(await db.select().from(incidents)).toEqual([]);
      expect(await db.select().from(dispatchedVehicles)).toEqual([]);
      expect(await db.select().from(dispatchedStations)).toEqual([]);
      const history = await loadHistory(db, INCIDENT_ID);
      expect(history.changes).toEqual([]);
      expect(history.anomalies).toEqual([]);
      // Snapshots are stored on their own, before the transaction.
      expect(history.snapshots).toHaveLength(4);
      const state = await loadSyncState(db, INCIDENT_ID);
      expect(state).toMatchObject({
        phase: "active",
        consecutiveFailures: 1,
        lastPolledAt: clock.now(),
        nextPollAt: new Date(clock.now().getTime() + 3 * MINUTE)
      });

      // The next poll writes everything.
      clock.advance(3 * MINUTE);
      const retry = await syncIncident(deps, INCIDENT_ID);
      expect(retry.kind).toBe("ok");
      expect(await db.select().from(incidents)).toHaveLength(1);
      expect((await loadHistory(db, INCIDENT_ID)).changes.length).toBeGreaterThan(0);
      expect((await loadSyncState(db, INCIDENT_ID))?.consecutiveFailures).toBe(0);
    });
  });

  describe("not-found deletion", () => {
    it("keeps the incident after one not-found poll and deletes it after two", async () => {
      const { deps, sigae, clock } = pipelineHarness(db);
      sigae.answers = answers({
        units: [unit(), unit({ IdBoletaUnidadDespachada: 5200102, CodigoUnidad: 152 })]
      });
      await syncIncident(deps, INCIDENT_ID);

      sigae.answers = NOT_FOUND_ANSWERS;
      clock.advance(3 * MINUTE);
      const first = await syncIncident(deps, INCIDENT_ID);
      expect(first).toMatchObject({ kind: "not_found", deleted: false });
      expect(await db.select().from(incidents)).toHaveLength(1);

      // Sooner than 3 minutes after the first one: doesn't count.
      clock.advance(MINUTE);
      const quick = await syncIncident(deps, INCIDENT_ID);
      expect(quick).toMatchObject({ kind: "not_found", deleted: false });
      expect(quick.syncState.notFoundCount).toBe(1);
      expect(await db.select().from(incidents)).toHaveLength(1);

      clock.advance(3 * MINUTE);
      const second = await syncIncident(deps, INCIDENT_ID);
      expect(second).toMatchObject({ kind: "not_found", deleted: true });
      expect(second.syncState).toMatchObject({ phase: "deleted", nextPollAt: null });

      expect(await db.select().from(incidents)).toEqual([]);
      expect(await db.select().from(dispatchedVehicles)).toEqual([]);
      expect(await db.select().from(dispatchedStations)).toEqual([]);
      const history = await loadHistory(db, INCIDENT_ID);
      expect(history.snapshots.length).toBeGreaterThanOrEqual(8);
      expect(history.changes.filter((change) => change.kind === "removed")).toHaveLength(4);
      expect(history.changes.filter((change) => change.kind === "added")).toHaveLength(4);
      expect(history.anomalies.map((anomaly) => anomaly.code)).toContain(
        "INCIDENT_DELETED_UPSTREAM"
      );

      // Deleted incidents aren't polled again unless forced.
      clock.advance(3 * MINUTE);
      const after = await syncIncident(deps, INCIDENT_ID);
      expect(after.kind).toBe("skipped");
    });
  });

  describe("reference resolution", () => {
    it("fetches an unknown station on demand and stores the poll", async () => {
      const { deps, sigae } = pipelineHarness(db, {
        references: {
          ObtenerEstacionDetalle: ({ params }) => ({
            body: sigaeFixtureBody("ObtenerEstacionDetalle", {
              IdEstacion: params.id_estacion,
              Nombre: "ESTACION NUEVA",
              ClaveEstacion: "9-9"
            })
          })
        }
      });
      sigae.answers = answers({
        stations: [station({ IdEstacion: 77, NombreEstacion: "ESTACION NUEVA" })],
        units: [unit({ CodigoEstacion: 77 })]
      });

      const outcome = await syncIncident(deps, INCIDENT_ID);

      expect(outcome.kind).toBe("ok");
      expect(outcome.references?.fetched.stations).toEqual([77]);
      const [stored] = await db.select().from(stations).where(eq(stations.id, 77));
      expect(stored).toMatchObject({
        name: "ESTACION NUEVA",
        stationKey: "9-9",
        isOperative: null
      });
      expect(await db.select().from(dispatchedStations)).toMatchObject([{ stationId: 77 }]);
      expect(outcome.anomalies.map((anomaly) => anomaly.code)).not.toContain("MISSING_REFERENCE");
    });

    it("fails the poll with MISSING_REFERENCE while a station stays unknown", async () => {
      const { deps, sigae, clock } = pipelineHarness(db);
      sigae.answers = answers({ stations: [station({ IdEstacion: 78 })] });

      const first = await syncIncident(deps, INCIDENT_ID);

      expect(first.kind).toBe("failed");
      expect(first.reason).toBe("MISSING_REFERENCE: unknown stations 78");
      expect(first.syncState.consecutiveFailures).toBe(1);
      expect(await db.select().from(incidents)).toEqual([]);
      const history = await loadHistory(db, INCIDENT_ID);
      const missing = history.anomalies.filter((row) => row.code === "MISSING_REFERENCE");
      expect(missing.map((row) => [row.entity, row.details])).toEqual([
        ["incident", { field: "responsibleStation", stationId: 78 }],
        ["dispatched_station", { field: "stationId", stationId: 78 }]
      ]);
      const detailCalls = () =>
        sigae.calls.filter((call) => call.endpoint === "ObtenerEstacionDetalle").length;
      expect(detailCalls()).toBe(1);

      // A miss isn't asked for again for 15 minutes, nor recorded twice.
      clock.advance(3 * MINUTE);
      const second = await syncIncident(deps, INCIDENT_ID);
      expect(second.kind).toBe("failed");
      expect(second.syncState.consecutiveFailures).toBe(2);
      expect(detailCalls()).toBe(1);
      expect((await loadHistory(db, INCIDENT_ID)).anomalies).toHaveLength(history.anomalies.length);
    });

    it("stores an unknown vehicle as NULL with its internal number", async () => {
      const { deps, sigae } = pipelineHarness(db);
      sigae.answers = answers({
        units: [unit({ CodigoUnidad: 999, IdVehiculo: 999, NumeroInterno: "M-99" })]
      });

      const outcome = await syncIncident(deps, INCIDENT_ID);

      expect(outcome.kind).toBe("ok");
      expect(await db.select().from(dispatchedVehicles)).toMatchObject([
        { id: 5200101, vehicleId: null, vehicleInternalNumber: "M-99" }
      ]);
      const { anomalies } = await loadHistory(db, INCIDENT_ID);
      expect(anomalies.filter((row) => row.code === "MISSING_REFERENCE")).toMatchObject([
        {
          code: "MISSING_REFERENCE",
          entity: "dispatched_vehicle",
          entityId: 5200101,
          details: { field: "vehicleId", vehicleId: 999, vehicleInternalNumber: "M-99" }
        }
      ]);
    });

    it("stores a vehicle whose internal number SIGAE moved from another vehicle", async () => {
      // Vehicle 140 is stored as M-12; SIGAE now gives M-12 to a new vehicle 860.
      const { deps, sigae } = pipelineHarness(db, {
        references: {
          ObtenerDatosVehiculo: ({ params }) => ({
            body: sigaeFixtureBody("ObtenerDatosVehiculo", {
              Id_vehiculo: params.Id_Vehiculo,
              Numero_interno: "M-12",
              Id_estacion: 2
            })
          })
        }
      });
      sigae.answers = answers({ units: [unit({ CodigoUnidad: 860, IdVehiculo: 860 })] });

      const outcome = await syncIncident(deps, INCIDENT_ID);

      expect(outcome.references?.failures).toEqual([]);
      expect(outcome.references?.fetched.vehicles).toEqual([860]);
      expect(await db.select().from(dispatchedVehicles)).toMatchObject([{ vehicleId: 860 }]);
      const [moved] = await db.select().from(vehicles).where(eq(vehicles.id, 860));
      expect(moved?.internalNumber).toBe("M-12");
      expect(outcome.anomalies.map((anomaly) => anomaly.code)).not.toContain("MISSING_REFERENCE");
    });

    it("refreshes incident types at most every 15 minutes while a code stays unknown", async () => {
      const { deps, sigae, clock } = pipelineHarness(db, {
        references: {
          ObtenerTiposIncidente: () => ({ body: sigaeFixtureBody("ObtenerTiposIncidente") })
        }
      });
      sigae.answers = answers({ details: detailsBody({ codigo_tipo_incidente: "9.9.9." }) });
      const typeCalls = () =>
        sigae.calls.filter((call) => call.endpoint === "ObtenerTiposIncidente").length;

      const first = await syncIncident(deps, INCIDENT_ID);
      expect(first.kind).toBe("ok");
      expect(typeCalls()).toBe(1);
      expect(first.anomalies.map((anomaly) => anomaly.code)).toContain("UNKNOWN_INCIDENT_TYPE");
      const [incident] = await db.select().from(incidents);
      expect(incident?.incidentCode).toBeNull();

      for (let poll = 0; poll < 4; poll += 1) {
        clock.advance(3 * MINUTE);
        await syncIncident(deps, INCIDENT_ID);
      }
      expect(typeCalls()).toBe(1);
      clock.advance(3 * MINUTE);
      await syncIncident(deps, INCIDENT_ID);
      expect(typeCalls()).toBe(2);
    });
  });

  describe("partial reports and kept units", () => {
    it("keeps known references of values a partial report can't clear", async () => {
      const { deps, sigae, clock } = pipelineHarness(db);
      sigae.answers = answers();
      await syncIncident(deps, INCIDENT_ID);

      const { Id_Provincia: _p, Id_Canton: _c, Id_Distrito: _d, ...partial } = reportBody();
      sigae.answers = answers({ report: { ...partial, ...CAST_ERROR } });
      clock.advance(3 * MINUTE);
      const outcome = await syncIncident(deps, INCIDENT_ID);

      expect(outcome.kind).toBe("partial");
      expect(outcome.anomalies.map((anomaly) => anomaly.code)).toEqual(["UPSTREAM_PARTIAL_REPORT"]);
      const [incident] = await db.select().from(incidents);
      expect(incident).toMatchObject({ provinceId: 1, cantonId: 101, districtId: 10101 });
    });

    it("keeps the units of a first empty unit list with their references", async () => {
      const { deps, sigae, clock } = pipelineHarness(db);
      sigae.answers = answers({
        stations: [station(), station({ IdBoletaEstacionAtiende: 3400102, IdEstacion: 5 })],
        units: [
          unit(),
          unit({ IdBoletaUnidadDespachada: 5200103, CodigoEstacion: 5, CodigoUnidad: 210 })
        ]
      });
      await syncIncident(deps, INCIDENT_ID);

      sigae.answers = answers({
        stations: [station(), station({ IdBoletaEstacionAtiende: 3400102, IdEstacion: 5 })],
        units: []
      });
      clock.advance(3 * MINUTE);
      const outcome = await syncIncident(deps, INCIDENT_ID);

      expect(outcome.kind).toBe("ok");
      expect(outcome.anomalies).toEqual([]);
      const rows = await db.select().from(dispatchedVehicles);
      expect(rows.map((row) => [row.id, row.vehicleId]).sort()).toEqual([
        [5200101, 140],
        [5200103, 210]
      ]);
    });
  });

  describe("manual sync (force)", () => {
    it("polls a finished incident only when forced, and records it like the worker", async () => {
      const harness = pipelineHarness(db);
      await replayScenario(db, harness, "discovered-closed");
      const done = await loadSyncState(db, INCIDENT_ID);
      expect(done?.phase).toBe("done");
      const before = await loadHistory(db, INCIDENT_ID);
      const callsBefore = harness.sigae.calls.length;

      harness.clock.advance(60 * MINUTE);
      const skipped = await syncIncident(harness.deps, INCIDENT_ID);
      expect(skipped.kind).toBe("skipped");
      expect(harness.sigae.calls).toHaveLength(callsBefore);

      const lastAnswers = harness.sigae.answers;
      const lastUnits = lastAnswers.ObtenerUnidadesDespachadasIncidente as { body: never };
      harness.sigae.answers = {
        ...lastAnswers,
        ObtenerUnidadesDespachadasIncidente: {
          body: {
            ...(lastUnits.body as Record<string, unknown>),
            Items: ((lastUnits.body as { Items: Record<string, unknown>[] }).Items ?? []).map(
              (item) => ({ ...item, HoraBase: "2026-10-12T23:00:00" })
            )
          }
        }
      };
      const forced = await syncIncident(harness.deps, INCIDENT_ID, { force: true });

      expect(forced.kind).toBe("ok");
      expect(forced.syncState.phase).toBe("done");
      expect(forced.changes.map((change) => change.field)).toContain("baseReturnTime");
      const after = await loadHistory(db, INCIDENT_ID);
      expect(after.changes.length).toBeGreaterThan(before.changes.length);
      expect(after.snapshots.length).toBe(before.snapshots.length + 1);
      expect((await loadSyncState(db, INCIDENT_ID))?.lastPolledAt).toEqual(harness.clock.now());
    });

    it("polls an incident with no sync state row", async () => {
      const { deps, sigae } = pipelineHarness(db);
      sigae.answers = answers();
      const outcome = await syncIncident(deps, INCIDENT_ID, { force: true });
      expect(outcome.kind).toBe("ok");
      expect(await db.select().from(incidentSyncState)).toHaveLength(1);
    });
  });

  describe("concurrent polls of one incident", () => {
    it("store each snapshot, change and failure count once", async () => {
      const { deps, sigae } = pipelineHarness(db, { delayMs: 20 });
      sigae.answers = answers({
        units: [unit(), unit({ IdBoletaUnidadDespachada: 5200102, CodigoUnidad: 152 })]
      });

      const outcomes = await Promise.all([
        syncIncident(deps, INCIDENT_ID),
        syncIncident(deps, INCIDENT_ID, { force: true })
      ]);

      expect(outcomes.map((outcome) => outcome.error)).toEqual([undefined, undefined]);
      const history = await loadHistory(db, INCIDENT_ID);
      expect(history.snapshots).toHaveLength(4);
      const added = history.changes.filter((change) => change.kind === "added");
      expect(added).toHaveLength(4);
      expect(await db.select().from(dispatchedVehicles)).toHaveLength(2);
    });

    it("count both of two concurrent failed polls", async () => {
      const { deps, sigae } = pipelineHarness(db, { delayMs: 20 });
      await saveSyncState(db, syncState({ nextPollAt: new Date("2026-10-11T02:00:00.000Z") }));
      sigae.answers = { ...answers(), ObtenerDetalleEmergencias: { status: 500 } };

      await Promise.all([
        syncIncident(deps, INCIDENT_ID, { force: true }),
        syncIncident(deps, INCIDENT_ID, { force: true })
      ]);

      // Without the lock both read 0 failures and the second write is lost.
      expect((await loadSyncState(db, INCIDENT_ID))?.consecutiveFailures).toBe(2);
    });

    it("skip the write of a worker poll that a newer manual sync overtook", async () => {
      const clock = fakeClock();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let gated = 0;
      const sigae = fakeSigae(async (call) => {
        const answer = answers()[call.endpoint as keyof IncidentAnswers];
        if (!answer) return { body: { ...NOT_FOUND } };
        if (gated < 4) {
          gated += 1;
          await gate;
        }
        return answer;
      });
      const deps = {
        db,
        sigae: sigae.client,
        references: createReferenceResolver({ db, sigae: sigae.client, now: clock.now }),
        now: clock.now
      };

      const worker = syncIncident(deps, INCIDENT_ID);
      await vi.waitFor(() => expect(gated).toBe(4));
      clock.advance(MINUTE);
      const manual = await syncIncident(deps, INCIDENT_ID, { force: true });
      expect(manual.kind).toBe("ok");
      // The worker's SIGAE answers arrived before the manual sync's.
      clock.advance(-MINUTE / 2);
      release();
      const overtaken = await worker;

      expect(overtaken).toMatchObject({ kind: "skipped", reason: "superseded by a newer poll" });
      expect(overtaken.syncState.lastPolledAt).toEqual(manual.polledAt);
      const history = await loadHistory(db, INCIDENT_ID);
      expect(history.changes).toHaveLength(manual.changes.length);
      expect(history.snapshots).toHaveLength(4);
    });
  });

  it("answers OK envelopes with every key the snapshot allowlists keep", async () => {
    const { deps, sigae } = pipelineHarness(db);
    sigae.answers = answers({ report: reportBody({ Telefono_Avisa: "8888-8888", ...OK }) });
    await syncIncident(deps, INCIDENT_ID);
    const { snapshots } = await loadHistory(db, INCIDENT_ID);
    expect(JSON.stringify(snapshots.map((row) => row.payload))).not.toContain("8888-8888");
  });
});
