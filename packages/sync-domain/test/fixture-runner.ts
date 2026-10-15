/**
 * Replays a fixture: `fixtures/<scenario>/001.json, 002.json, …` (one poll each, with the
 * four endpoint payloads) through the pure core, keeping the stored state in memory.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { classifyPoll } from "../src/poll/classify";
import { processPoll } from "../src/poll/process";
import { anomalyKey } from "../src/reconcile/anomalies";
import { KNOWN_INCIDENT_TYPES, decode, type EndpointInput } from "./builders";

import type { IncidentState, SigaeIncidentEndpoint, SyncState } from "../src/types";

export const FIXTURES_DIR = new URL("../fixtures/", import.meta.url).pathname;

export interface FixtureSnapshot {
  incidentId: number;
  /** When the poll ran (ISO 8601). */
  fetchedAt: string;
  responses: Record<SigaeIncidentEndpoint, EndpointInput>;
}

export interface FixtureOutcome {
  polls: {
    poll: string;
    kind: string;
    phase: string;
    nextPollAt: string | null;
    deleteIncident: boolean;
  }[];
  changes: Record<string, unknown>[];
  anomalies: Record<string, unknown>[];
  final: { state: IncidentState | null; syncState: SyncState };
}

export function listScenarios(): string[] {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function snapshotFiles(scenario: string): string[] {
  return readdirSync(join(FIXTURES_DIR, scenario))
    .filter((name) => /^\d{3}\.json$/.test(name))
    .sort();
}

export function readSnapshot(scenario: string, file: string): FixtureSnapshot {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, scenario, file), "utf8")) as FixtureSnapshot;
}

export function runScenario(scenario: string): FixtureOutcome {
  const files = snapshotFiles(scenario);
  const outcome: FixtureOutcome = {
    polls: [],
    changes: [],
    anomalies: [],
    final: { state: null, syncState: undefined as unknown as SyncState }
  };
  let current: IncidentState | null = null;
  let syncState: SyncState | null = null;
  const recorded = new Set<string>();

  for (const file of files) {
    const snapshot = readSnapshot(scenario, file);
    const now = new Date(snapshot.fetchedAt);
    syncState ??= {
      incidentId: snapshot.incidentId,
      phase: "active",
      nextPollAt: null,
      lastPolledAt: null,
      upstreamClosedAt: null,
      consecutiveFailures: 0,
      notFoundCount: 0,
      emptyUnitsCount: 0,
      lastError: null,
      firstSeenAt: now
    };
    const { responses } = snapshot;
    const classification = classifyPoll({
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
    const result = processPoll({
      incidentId: snapshot.incidentId,
      classification,
      current,
      syncState,
      knownIncidentTypes: KNOWN_INCIDENT_TYPES,
      recordedAnomalies: recorded,
      now
    });

    if (result.deleteIncident) current = null;
    else if (result.next) current = result.next;
    syncState = result.syncState;
    for (const anomaly of result.anomalies) recorded.add(anomalyKey(anomaly));

    outcome.polls.push({
      poll: file,
      kind: result.kind,
      phase: syncState.phase,
      nextPollAt: syncState.nextPollAt?.toISOString() ?? null,
      deleteIncident: result.deleteIncident
    });
    outcome.changes.push(...result.changes.map((change) => ({ poll: file, ...change })));
    outcome.anomalies.push(...result.anomalies.map((anomaly) => ({ poll: file, ...anomaly })));
  }

  if (!syncState) throw new Error(`Fixture ${scenario} has no snapshots`);
  outcome.final = { state: current, syncState };
  return toPlainJson(outcome);
}

/** Dates become ISO strings, as in `expected.json`. */
export function toPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
