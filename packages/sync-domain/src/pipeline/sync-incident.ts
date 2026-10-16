import { nextPoll } from "../lifecycle/next-poll";
import {
  loadIncidentState,
  loadRecordedAnomalies,
  loadSyncState,
  saveSyncState
} from "../persist/incident-state";
import { persistPollResult } from "../persist/poll-result";
import { type SnapshotInput, type StoredSnapshots, storeSnapshots } from "../persist/snapshots";
import { classifyPoll, type IncidentPollResponses, type PollKind } from "../poll/classify";
import { processPoll } from "../poll/process";
import { pollReferences } from "../poll/references";
import { anomalyKey } from "../reconcile/anomalies";
import { payloadHash, redactSnapshot } from "../redact/redact";
import { describeError } from "./errors";

import type {
  Anomaly,
  Change,
  IncidentSyncPhase,
  SigaeIncidentEndpoint,
  SyncState
} from "../types";
import type { ReferenceResolution, ReferenceResolver } from "./references";
import type { Database } from "@bomberoscr/db/client";
import type { SigaeCallOptions, SigaeClient } from "@bomberoscr/sigae/client";

/** The SIGAE calls one poll makes. */
export type IncidentSigae = Pick<
  SigaeClient,
  "getIncidentDetails" | "getIncidentReport" | "getDispatchedStations" | "getDispatchedUnits"
>;

export interface SyncIncidentDeps {
  db: Database;
  sigae: IncidentSigae;
  references: ReferenceResolver;
  now: () => Date;
  /** Runs a step inside a span named `name`. Without it, steps just run. */
  span?: <T>(name: string, step: () => Promise<T>) => Promise<T>;
}

export interface SyncIncidentOptions {
  /** Poll even when the incident is no longer polled (`done`, `deleted`, `failed`). */
  force?: boolean;
  signal?: AbortSignal;
}

/** Phases with nothing left to poll. */
export const FINISHED_PHASES: ReadonlySet<IncidentSyncPhase> = new Set([
  "done",
  "deleted",
  "failed"
]);

export interface SyncIncidentOutcome {
  incidentId: number;
  /** `skipped`: the incident is no longer polled and `force` wasn't set. */
  kind: PollKind | "skipped";
  /** Why the poll failed: `lastError`. */
  reason: string | null;
  changes: Change[];
  anomalies: Anomaly[];
  /** The sync state after the poll. */
  syncState: SyncState;
  /** When the poll was due (`nextPollAt` before it), for polling lag. */
  scheduledAt: Date | null;
  startedAt: Date;
  /** When SIGAE answered: the poll's time for snapshots, changes and the lifecycle. */
  polledAt: Date;
  /** The not-found flow deleted the incident. */
  deleted: boolean;
  snapshots: StoredSnapshots | null;
  references: ReferenceResolution | null;
  /** A database or other internal error that turned the poll into a failed one. */
  error?: unknown;
}

const ENDPOINT_KEYS = {
  ObtenerDetalleEmergencias: "details",
  ObtenerBoletaIncidente: "report",
  ObtenerEstacionesAtiendeIncidente: "stations",
  ObtenerUnidadesDespachadasIncidente: "units"
} as const satisfies Record<SigaeIncidentEndpoint, keyof IncidentPollResponses>;

/**
 * One poll of one incident (spec section 4 pipeline): fetch the four endpoints, classify,
 * store changed snapshots, resolve references, run the pure core, and write the result and
 * the next sync state in one transaction. Scheduling the next poll is up to the caller,
 * from `syncState.nextPollAt`.
 *
 * SIGAE failures are failed polls. So are database errors after the sync state was read:
 * the failure is counted in the sync state, and only an error saving it is thrown.
 */
export async function syncIncident(
  deps: SyncIncidentDeps,
  incidentId: number,
  options: SyncIncidentOptions = {}
): Promise<SyncIncidentOutcome> {
  const { db } = deps;
  const span = deps.span ?? ((_name, step) => step());
  const startedAt = deps.now();

  const stored = await loadSyncState(db, incidentId);
  const previous = stored ?? newSyncState(incidentId, startedAt);
  const base = {
    incidentId,
    scheduledAt: stored?.nextPollAt ?? null,
    startedAt,
    deleted: false,
    changes: [],
    anomalies: []
  };
  if (stored && FINISHED_PHASES.has(stored.phase) && !options.force) {
    return {
      ...base,
      kind: "skipped",
      reason: null,
      syncState: stored,
      polledAt: startedAt,
      snapshots: null,
      references: null
    };
  }

  const responses = await fetchIncidentResponses(deps.sigae, incidentId, {
    signal: options.signal
  });
  const polledAt = deps.now();
  const classification = classifyPoll(responses);

  let snapshots: StoredSnapshots | null = null;
  let references: ReferenceResolution | null = null;
  try {
    snapshots = await storeSnapshots(db, incidentId, polledAt, snapshotInputs(responses));
    references = await deps.references.resolve(pollReferences(incidentId, classification));
    const [current, recorded] = await Promise.all([
      loadIncidentState(db, incidentId),
      loadRecordedAnomalies(db, incidentId)
    ]);

    const result = processPoll({
      incidentId,
      classification,
      current,
      syncState: previous,
      knownIncidentTypes: references.known.incidentTypes,
      knownReferences: references.known,
      recordedAnomalies: new Set(recorded.map(anomalyKey)),
      now: polledAt
    });

    await span("sync.poll.transaction", () =>
      persistPollResult(db, {
        incidentId,
        next: result.next,
        deleteIncident: result.deleteIncident,
        changes: result.changes,
        anomalies: result.anomalies,
        syncState: result.syncState,
        snapshotIds: Object.values(snapshots?.ids ?? {}).sort((a, b) => a - b),
        now: polledAt
      })
    );

    return {
      ...base,
      kind: result.kind,
      reason: result.kind === "failed" ? result.syncState.lastError : null,
      changes: result.changes,
      anomalies: result.anomalies,
      syncState: result.syncState,
      polledAt,
      deleted: result.deleteIncident,
      snapshots,
      references
    };
  } catch (error) {
    const reason = `internal error: ${describeError(error)}`;
    const decision = nextPoll(previous, { kind: "failed", reason }, polledAt);
    const syncState: SyncState = { ...decision.state, emptyUnitsCount: 0 };
    await saveSyncState(db, syncState);
    return {
      ...base,
      kind: "failed",
      reason,
      syncState,
      polledAt,
      snapshots,
      references,
      error
    };
  }
}

/** The four incident endpoints, at once. Request failures stay in each result. */
export async function fetchIncidentResponses(
  sigae: IncidentSigae,
  incidentId: number,
  options?: SigaeCallOptions
): Promise<IncidentPollResponses> {
  const [details, report, stations, units] = await Promise.all([
    sigae.getIncidentDetails(incidentId, options),
    sigae.getIncidentReport(incidentId, options),
    sigae.getDispatchedStations(incidentId, options),
    sigae.getDispatchedUnits(incidentId, options)
  ]);
  return { details, report, stations, units };
}

/** Redacted snapshots of every endpoint that answered, whatever it answered. */
export function snapshotInputs(responses: IncidentPollResponses): SnapshotInput[] {
  const inputs: SnapshotInput[] = [];
  for (const [endpoint, key] of Object.entries(ENDPOINT_KEYS) as [
    SigaeIncidentEndpoint,
    keyof IncidentPollResponses
  ][]) {
    const result = responses[key];
    if (result.isErr()) continue;
    const { raw } = result.value;
    const payload = redactSnapshot(endpoint, raw);
    inputs.push({
      endpoint,
      codigo: typeof raw.Codigo === "string" ? raw.Codigo : null,
      payload,
      payloadHash: payloadHash(payload)
    });
  }
  return inputs;
}

/** The state of an incident polled for the first time without a row (a manual sync). */
export function newSyncState(incidentId: number, now: Date): SyncState {
  return {
    incidentId,
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
}
