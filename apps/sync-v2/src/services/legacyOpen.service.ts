import { and, asc, eq, isNull } from "@bomberoscr/db/operators";
import { incidentSyncState, incidents } from "@bomberoscr/db/schema";
import { LIFECYCLE } from "@bomberoscr/sync-domain/lifecycle";
import {
  type SyncIncidentDeps,
  type SyncIncidentOutcome,
  describeError,
  syncIncident
} from "@bomberoscr/sync-domain/pipeline";

const DEFAULT_CONCURRENCY = 4;

export interface LegacyOpenResult {
  /** Open incidents without a sync state when the run started. */
  found: number;
  /** Closed upstream long ago: polled once and marked `done` instead of settling. */
  closed: number[];
  /** Closed upstream and reported within the settling window: they settle as usual. */
  settling: number[];
  /** Still open upstream and younger than the open cap: polled like any tracked incident. */
  active: number[];
  /** Still open upstream past the open cap: `done` with `OPEN_TOO_LONG`. */
  openTooLong: number[];
  /**
   * Another poll stored a newer answer meanwhile (the running service started tracking it):
   * that poll's result stands.
   */
  skipped: number[];
  /**
   * Not found upstream: not tracked and not deleted, though the poll's snapshots and
   * anomalies are stored. A later run tries them again.
   */
  notFound: number[];
  /**
   * The poll failed (SIGAE or the database) or threw, reported through `onFailed`. A later
   * run retries the ones still untracked.
   */
  failed: number[];
}

/**
 * The legacy sync left incidents open that it stopped polling (`incidents.is_open` with no
 * `incident_sync_state` row); new sync only polls what it tracks, so nothing would ever close
 * them. Each one gets one forced poll, which stores SIGAE's answer and starts tracking it when
 * SIGAE answers. Incidents SIGAE closed are marked `done` unless they were reported within the
 * settling window, so hundreds of old incidents don't settle for 72 hours each.
 *
 * A forced poll of an untracked incident that isn't found or fails leaves it untracked (see
 * `syncIncident`), so a not-found answer never deletes a historical incident. Safe to run
 * again: adopted incidents have a sync state and are no longer selected.
 */
export async function adoptLegacyOpenIncidents(
  deps: SyncIncidentDeps,
  options: {
    concurrency?: number;
    signal?: AbortSignal;
    /** After each poll, with how many are done out of `found`. */
    onPolled?: (polled: number, found: number) => void;
    /** For each incident in `failed`, with why (redacted, see `describeError`). */
    onFailed?: (incidentId: number, reason: string) => void;
  } = {}
): Promise<LegacyOpenResult> {
  const candidates = await deps.db
    .select({ id: incidents.id, incidentTimestamp: incidents.incidentTimestamp })
    .from(incidents)
    .leftJoin(incidentSyncState, eq(incidentSyncState.incidentId, incidents.id))
    .where(and(eq(incidents.isOpen, true), isNull(incidentSyncState.incidentId)))
    .orderBy(asc(incidents.id));

  const result: LegacyOpenResult = {
    found: candidates.length,
    closed: [],
    settling: [],
    active: [],
    openTooLong: [],
    skipped: [],
    notFound: [],
    failed: []
  };

  let next = 0;
  let polled = 0;
  const poll = async () => {
    while (next < candidates.length && !options.signal?.aborted) {
      const candidate = candidates[next++];
      if (!candidate) break;
      try {
        const outcome = await syncIncident(deps, candidate.id, {
          force: true,
          signal: options.signal
        });
        const reason = await settle(deps, candidate, outcome, result);
        if (reason !== null) {
          result.failed.push(candidate.id);
          options.onFailed?.(candidate.id, reason);
        }
      } catch (error) {
        result.failed.push(candidate.id);
        options.onFailed?.(candidate.id, describeError(error));
      }
      options.onPolled?.(++polled, candidates.length);
    }
  };
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  await Promise.all(Array.from({ length: concurrency }, poll));

  for (const ids of Object.values(result)) {
    if (Array.isArray(ids)) ids.sort((a, b) => a - b);
  }
  return result;
}

/** Files the incident under its outcome; returns why it failed, or `null`. */
async function settle(
  deps: SyncIncidentDeps,
  candidate: { id: number; incidentTimestamp: Date },
  outcome: SyncIncidentOutcome,
  result: LegacyOpenResult
): Promise<string | null> {
  const { id } = candidate;
  if (outcome.kind === "skipped") return push(result.skipped, id);
  if (outcome.kind === "not_found") return push(result.notFound, id);
  if (outcome.kind !== "ok" && outcome.kind !== "partial") {
    return outcome.reason ?? outcome.kind;
  }

  const { phase } = outcome.syncState;
  if (phase === "active") return push(result.active, id);
  if (phase === "done") return push(result.openTooLong, id);
  if (phase !== "settling") return `unexpected phase after the poll: ${phase}`;

  const reportedFor = deps.now().getTime() - candidate.incidentTimestamp.getTime();
  if (reportedFor < LIFECYCLE.settlingWindow) return push(result.settling, id);
  await deps.db
    .update(incidentSyncState)
    .set({ phase: "done", nextPollAt: null })
    .where(and(eq(incidentSyncState.incidentId, id), eq(incidentSyncState.phase, "settling")));
  return push(result.closed, id);
}

function push(ids: number[], id: number): null {
  ids.push(id);
  return null;
}
