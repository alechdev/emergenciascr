import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { snapshotInputs, syncIncident } from "../../src/pipeline/sync-incident";
import { decode } from "../builders";
import {
  FIXTURES_DIR,
  TEST_DATABASE_URL,
  type TestDatabase,
  fixtureAnswers,
  listScenarios,
  loadHistory,
  openTestDatabase,
  pipelineHarness,
  readSnapshot,
  replayScenario,
  resetDatabase,
  seedReferences,
  snapshotFiles
} from "./harness";

import type { FixtureSnapshot } from "./harness";

/** How many snapshot rows a scenario should leave: one per endpoint whose hash changed. */
function expectedSnapshotRows(scenario: string): number {
  const latest = new Map<string, string>();
  let rows = 0;
  for (const file of snapshotFiles(scenario)) {
    const { responses } = readSnapshot(scenario, file) as FixtureSnapshot;
    const inputs = snapshotInputs({
      details: decode("ObtenerDetalleEmergencias", responses.ObtenerDetalleEmergencias),
      report: decode("ObtenerBoletaIncidente", responses.ObtenerBoletaIncidente),
      stations: decode(
        "ObtenerEstacionesAtiendeIncidente",
        responses.ObtenerEstacionesAtiendeIncidente
      ),
      units: decode(
        "ObtenerUnidadesDespachadasIncidente",
        responses.ObtenerUnidadesDespachadasIncidente
      )
    });
    for (const input of inputs) {
      if (latest.get(input.endpoint) === input.payloadHash) continue;
      latest.set(input.endpoint, input.payloadHash);
      rows += 1;
    }
  }
  return rows;
}

describe.skipIf(!TEST_DATABASE_URL)("fixture replay through syncIncident", () => {
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

  for (const scenario of listScenarios()) {
    it(`${scenario} stores what expected.json says`, async () => {
      const harness = pipelineHarness(db);
      const outcome = await replayScenario(db, harness, scenario);
      const expected = JSON.parse(
        readFileSync(join(FIXTURES_DIR, scenario, "expected.json"), "utf8")
      ) as typeof outcome;

      expect(outcome).toEqual(expected);

      const incidentId = readSnapshot(scenario, snapshotFiles(scenario)[0] as string).incidentId;
      const history = await loadHistory(db, incidentId);
      expect(history.changes.map((row) => [row.entity, row.entityId, row.field, row.kind])).toEqual(
        expected.changes.map((change) => [
          change.entity,
          change.entityId,
          change.field,
          change.kind
        ])
      );
      expect(history.changes.every((row) => row.snapshotIds.length > 0)).toBe(true);
      expect(history.anomalies.map((row) => [row.code, row.entity, row.entityId])).toEqual(
        expected.anomalies.map((anomaly) => [anomaly.code, anomaly.entity, anomaly.entityId])
      );
      expect(history.snapshots).toHaveLength(expectedSnapshotRows(scenario));
      expect(history.snapshots.every((row) => row.incidentId === incidentId)).toBe(true);
    });
  }

  it("stores no new snapshots, changes or incident write for identical responses", async () => {
    const harness = pipelineHarness(db);
    await replayScenario(db, harness, "units-added-removed");
    const files = snapshotFiles("units-added-removed");
    const last = readSnapshot("units-added-removed", files.at(-1) as string);
    const before = await loadHistory(db, last.incidentId);
    const [incidentBefore] = await db.query.incidents.findMany();

    harness.clock.set(new Date(new Date(last.fetchedAt).getTime() + 3 * 60_000));
    harness.sigae.answers = fixtureAnswers(last);
    const outcome = await syncIncident(harness.deps, last.incidentId);

    expect(outcome.kind).toBe("ok");
    expect(outcome.changes).toEqual([]);
    expect(outcome.snapshots?.inserted).toEqual([]);
    const after = await loadHistory(db, last.incidentId);
    expect(after.snapshots).toHaveLength(before.snapshots.length);
    expect(after.changes).toHaveLength(before.changes.length);
    expect(after.anomalies).toHaveLength(before.anomalies.length);
    const [incidentAfter] = await db.query.incidents.findMany();
    expect(incidentAfter?.modifiedAt).toEqual(incidentBefore?.modifiedAt);
    expect(outcome.syncState.lastPolledAt).toEqual(harness.clock.now());
  });

  it("stores incident, units and stations rows as the final state says", async () => {
    const harness = pipelineHarness(db);
    const outcome = await replayScenario(db, harness, "units-added-removed");
    const vehicles = await db.query.dispatchedVehicles.findMany();
    const stations = await db.query.dispatchedStations.findMany();
    expect(vehicles.map((row) => row.id).sort()).toEqual(
      outcome.final.state?.vehicles.map((row) => row.id).sort()
    );
    expect(stations.map((row) => row.id).sort()).toEqual(
      outcome.final.state?.stations.map((row) => row.id).sort()
    );
    const syncRows = await db.query.incidentSyncState.findMany();
    expect(syncRows).toHaveLength(1);
  });
});
