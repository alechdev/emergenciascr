import { nextPoll } from "../lifecycle/next-poll";
import {
  loadIncidentState,
  loadRecordedAnomalies,
  loadSyncState,
  lockIncident,
  saveSyncState
} from "../persist/incident-state";
import { insertAnomalies, writePollResult } from "../persist/poll-result";
import { findKnownReferences } from "../persist/references";
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
  /**
   * `skipped`, with nothing written: without `force`, the incident is no longer polled; a
   * newer poll was stored while this one ran (`reason`: "superseded by a newer poll"); or a
   * `deleted` incident is still not found ("already deleted").
   */
  kind: PollKind | "skipped";
  /** Why the poll failed (`lastError`), or why it was skipped. */
  reason: string | null;
  changes: Change[];
  anomalies: Anomaly[];
  /**
   * The sync state after the poll. Not stored when a forced poll of an incident without a
   * sync state didn't succeed: see {@link syncIncident}.
   */
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
 * Polls of the same incident are serialized by a per-incident lock from the snapshot write
 * on. A poll that finds a newer poll stored meanwhile writes nothing and returns `skipped`;
 * so does one without `force` that finds the incident finished.
 *
 * Only tracked incidents are polled on a schedule (spec section 8.4), so a forced poll (a
 * manual sync) of an incident without a sync state row only creates one when it succeeds
 * (`ok` or `partial`). A not-found or failed result stores its snapshots and anomalies but
 * no sync state, so it neither starts polling the incident nor counts toward deleting it.
 * Without `force`, the caller tracks the incident: a missing row starts as a new one.
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
  const skipped = (syncState: SyncState, reason: string | null): SyncIncidentOutcome => ({
    ...base,
    kind: "skipped",
    reason,
    syncState,
    polledAt,
    snapshots,
    references
  });

  try {
    // Every write below holds the incident's lock, so a manual sync and the worker polling
    // the same incident can't both see "no snapshot yet" or diff against the same state.
    snapshots = await span("sync.poll.snapshots", () =>
      db.transaction(async (tx) => {
        await lockIncident(tx, incidentId);
        return storeSnapshots(tx, incidentId, polledAt, snapshotInputs(responses));
      })
    );
    // Fetching references from SIGAE happens outside the lock; the upserts are idempotent.
    references = await span("sync.poll.references", async () =>
      deps.references.resolve(
        pollReferences(incidentId, classification, await loadIncidentState(db, incidentId))
      )
    );
    const snapshotIds = Object.values(snapshots.ids).sort((a, b) => a - b);

    const written = await span("sync.poll.transaction", () =>
      db.transaction(async (tx) => {
        await lockIncident(tx, incidentId);
        const latest = await loadSyncState(tx, incidentId);
        const superseded = supersededBy(latest, polledAt, options);
        if (superseded) return superseded;
        if (latest?.phase === "deleted" && classification.kind === "not_found") {
          return { skip: latest, reason: "already deleted" };
        }

        const [current, recorded] = await Promise.all([
          loadIncidentState(tx, incidentId),
          loadRecordedAnomalies(tx, incidentId)
        ]);
        const known = await findKnownReferences(
          tx,
          pollReferences(incidentId, classification, current)
        );
        const result = processPoll({
          incidentId,
          classification,
          current,
          syncState: latest ?? previous,
          knownIncidentTypes: known.incidentTypes,
          inferredIncidentTypes: known.inferredIncidentTypes,
          knownReferences: known,
          recordedAnomalies: new Set(recorded.map(anomalyKey)),
          now: polledAt
        });
        if (!latest && options.force && result.kind !== "ok" && result.kind !== "partial") {
          await insertAnomalies(tx, incidentId, result.anomalies, polledAt);
          return { result };
        }
        await writePollResult(tx, {
          incidentId,
          next: result.next,
          incidentTypes: result.newIncidentTypes,
          deleteIncident: result.deleteIncident,
          changes: result.changes,
          anomalies: result.anomalies,
          syncState: result.syncState,
          snapshotIds,
          now: polledAt
        });
        return { result };
      })
    );
    if ("skip" in written) return skipped(written.skip, written.reason);

    const { result } = written;
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
    const failed = await db.transaction(async (tx) => {
      await lockIncident(tx, incidentId);
      const latest = await loadSyncState(tx, incidentId);
      const superseded = supersededBy(latest, polledAt, options);
      if (superseded) return superseded;
      const decision = nextPoll(latest ?? previous, { kind: "failed", reason }, polledAt);
      const syncState: SyncState = { ...decision.state, emptyUnitsCount: 0 };
      if (latest || !options.force) await saveSyncState(tx, syncState);
      return { syncState };
    });
    if ("skip" in failed) return { ...skipped(failed.skip, failed.reason), error };
    return {
      ...base,
      kind: "failed",
      reason,
      syncState: failed.syncState,
      polledAt,
      snapshots,
      references,
      error
    };
  }
}

/**
 * Whether the state stored meanwhile makes this poll's result moot: another poll stored a
 * newer answer while this one waited for SIGAE or the lock (writing older data would move
 * `lastPolledAt` back and could reopen or re-close the incident), or, without `force`, the
 * incident finished.
 */
function supersededBy(
  latest: SyncState | null,
  polledAt: Date,
  options: SyncIncidentOptions
): { skip: SyncState; reason: string | null } | null {
  if (!latest) return null;
  if (!options.force && FINISHED_PHASES.has(latest.phase)) return { skip: latest, reason: null };
  if (latest.lastPolledAt !== null && latest.lastPolledAt > polledAt) {
    return { skip: latest, reason: "superseded by a newer poll" };
  }
  return null;
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
