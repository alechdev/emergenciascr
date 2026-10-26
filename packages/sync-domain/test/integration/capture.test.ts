import { createDatabase } from "@bomberoscr/db/client";
import { sql } from "@bomberoscr/db/operators";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type CapturedPoll,
  buildFixturePolls,
  loadSnapshotRows,
  readOnlyConnection,
  writeFixturePolls
} from "../../scripts/fixture-capture";
import { snapshotInputs, syncIncident } from "../../src/pipeline/sync-incident";
import { redactSnapshot } from "../../src/redact/index";
import { decode } from "../builders";
import {
  TEST_DATABASE_URL,
  type FixtureSnapshot,
  type IncidentAnswers,
  type TestDatabase,
  listScenarios,
  openTestDatabase,
  pipelineHarness,
  readSnapshot,
  replayScenario,
  resetDatabase,
  seedReferences,
  snapshotFiles
} from "./harness";

import type { SigaeIncidentEndpoint } from "../../src/types";

const LOCATION_FIELDS = new Set([
  "DesUbicacion",
  "Direccion",
  "direccion",
  "latitud",
  "longitud",
  "address",
  "importantDetails",
  "latitude",
  "longitude"
]);

/**
 * Hides location values, which the capture replaces, keeping whether one is there: empty,
 * `null` and zero values stay as they are.
 */
function withoutLocations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLocations);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const masked: Record<string, unknown> = {};
  const isLocationField = typeof record.field === "string" && LOCATION_FIELDS.has(record.field);
  for (const [key, item] of Object.entries(record)) {
    const hide =
      LOCATION_FIELDS.has(key) ||
      (isLocationField && (key === "oldValue" || key === "newValue")) ||
      (record.code === "COORDINATES_MOVED" && key === "details");
    masked[key] =
      hide && item !== null && item !== "" && item !== 0 && item !== "0"
        ? "<location>"
        : withoutLocations(item);
  }
  return masked;
}

function decodeAll(responses: FixtureSnapshot["responses"]) {
  return {
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
  };
}

/** What the capture should produce from a scenario's polls, before location masking. */
function expectedCapture(scenario: string) {
  const hashes = new Map<SigaeIncidentEndpoint, string>();
  const latest = new Map<SigaeIncidentEndpoint, unknown>();
  const polls: { fetchedAt: string; bodies: Map<SigaeIncidentEndpoint, unknown> }[] = [];
  let lossless = true;
  for (const file of snapshotFiles(scenario)) {
    const { fetchedAt, responses } = readSnapshot(scenario, file) as FixtureSnapshot;
    let stored = false;
    for (const input of snapshotInputs(decodeAll(responses))) {
      latest.set(input.endpoint, redactSnapshot(input.endpoint, input.payload));
      if (hashes.get(input.endpoint) === input.payloadHash) continue;
      hashes.set(input.endpoint, input.payloadHash);
      stored = true;
    }
    if (Object.values(responses).some((response) => "error" in response)) lossless = false;
    if (stored) polls.push({ fetchedAt, bodies: new Map(latest) });
    else lossless = false;
  }
  return { polls, lossless };
}

describe.skipIf(!TEST_DATABASE_URL)("fixture capture from sigae_snapshots", () => {
  let db: TestDatabase;
  let readOnly: TestDatabase;
  let output: string;

  beforeAll(async () => {
    db = await openTestDatabase();
    readOnly = createDatabase(readOnlyConnection(TEST_DATABASE_URL!));
    output = mkdtempSync(join(tmpdir(), "sync-domain-capture-"));
  });
  afterAll(async () => {
    await readOnly?.$client.end();
    await db?.$client.end();
    if (output) rmSync(output, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetDatabase(db);
    await seedReferences(db);
  });

  it("reads through a connection that can't write", async () => {
    // 25006: read_only_sql_transaction.
    await expect(readOnly.execute(sql`create table capture_probe (id int)`)).rejects.toMatchObject({
      cause: { code: "25006" }
    });
  });

  for (const scenario of listScenarios()) {
    it(`captures ${scenario} back from the snapshots its replay stored`, async () => {
      const source = await replayScenario(db, pipelineHarness(db), scenario);
      const incidentId = readSnapshot(scenario, "001.json").incidentId;

      const rows = await loadSnapshotRows(readOnly, incidentId);
      const polls = buildFixturePolls(incidentId, rows);
      const files = writeFixturePolls(join(output, scenario), polls);
      expect(readdirSync(join(output, scenario)).sort()).toEqual(files);
      for (const [index, file] of files.entries()) {
        expect(JSON.parse(readFileSync(join(output, scenario, file), "utf8"))).toEqual(
          polls[index]
        );
      }

      // One poll per poll that stored a snapshot, with every endpoint's latest answer.
      const expected = expectedCapture(scenario);
      expect(polls.map((poll) => poll.fetchedAt)).toEqual(
        expected.polls.map((poll) => poll.fetchedAt)
      );
      for (const [index, poll] of polls.entries()) {
        for (const [endpoint, response] of Object.entries(poll.responses)) {
          const body = expected.polls[index]?.bodies.get(endpoint as SigaeIncidentEndpoint);
          if (body === undefined) {
            expect(response).toHaveProperty("error");
          } else {
            expect(withoutLocations((response as { body: unknown }).body)).toEqual(
              withoutLocations(body)
            );
          }
        }
      }
      expect(JSON.stringify(polls)).not.toContain("SINTETICA");

      // When every poll stored something and none failed, the capture replays the same way.
      if (!expected.lossless) return;
      await resetDatabase(db);
      await seedReferences(db);
      const harness = pipelineHarness(db);
      const replayed = await replayPolls(harness, polls);
      expect(withoutLocations(replayed.polls)).toEqual(withoutLocations(source.polls));
      expect(withoutLocations(replayed.changes)).toEqual(withoutLocations(source.changes));
      expect(withoutLocations(replayed.anomalies)).toEqual(withoutLocations(source.anomalies));
    });
  }

  async function replayPolls(harness: ReturnType<typeof pipelineHarness>, polls: CapturedPoll[]) {
    const outcome = {
      polls: [] as unknown[],
      changes: [] as unknown[],
      anomalies: [] as unknown[]
    };
    for (const [index, poll] of polls.entries()) {
      const file = `${String(index + 1).padStart(3, "0")}.json`;
      harness.clock.set(poll.fetchedAt);
      harness.sigae.answers = poll.responses as IncidentAnswers;
      const result = await syncIncident(harness.deps, poll.incidentId);
      if (result.error) throw result.error;
      outcome.polls.push({
        poll: file,
        kind: result.kind,
        phase: result.syncState.phase,
        nextPollAt: result.syncState.nextPollAt?.toISOString() ?? null,
        deleteIncident: result.deleted
      });
      outcome.changes.push(...result.changes.map((change) => ({ poll: file, ...change })));
      outcome.anomalies.push(...result.anomalies.map((anomaly) => ({ poll: file, ...anomaly })));
    }
    return JSON.parse(JSON.stringify(outcome)) as typeof outcome;
  }
});
