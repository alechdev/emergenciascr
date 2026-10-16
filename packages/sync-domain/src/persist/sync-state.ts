import { and, count, inArray } from "@bomberoscr/db/operators";
import { INCIDENT_SYNC_PHASES, incidentSyncState } from "@bomberoscr/db/schema";

import type { IncidentSyncPhase } from "../types";
import type { Executor } from "./executor";

export interface NewTrackedIncident {
  incidentId: number;
  /** When the sync first saw it; also its first poll time. */
  firstSeenAt: Date;
}

/**
 * Starts tracking incidents (phase `active`, due now). Incidents that already have a row, in
 * any phase, are left alone. Returns the IDs that were new.
 */
export async function trackNewIncidents(
  db: Executor,
  incidents: readonly NewTrackedIncident[]
): Promise<number[]> {
  if (incidents.length === 0) return [];
  const rows = await db
    .insert(incidentSyncState)
    .values(
      incidents.map(({ incidentId, firstSeenAt }) => ({
        incidentId,
        phase: "active" as const,
        nextPollAt: firstSeenAt,
        firstSeenAt
      }))
    )
    .onConflictDoNothing({ target: incidentSyncState.incidentId })
    .returning({ incidentId: incidentSyncState.incidentId });
  return rows.map((row) => row.incidentId);
}

export interface ScheduledIncident {
  incidentId: number;
  nextPollAt: Date | null;
}

/**
 * Incidents still being polled (`active` and `settling`), to rebuild the queue from; only
 * among `incidentIds` when given.
 */
export async function listPolledIncidents(
  db: Executor,
  incidentIds?: readonly number[]
): Promise<ScheduledIncident[]> {
  if (incidentIds?.length === 0) return [];
  const polled = inArray(incidentSyncState.phase, ["active", "settling"]);
  return db
    .select({ incidentId: incidentSyncState.incidentId, nextPollAt: incidentSyncState.nextPollAt })
    .from(incidentSyncState)
    .where(
      incidentIds ? and(polled, inArray(incidentSyncState.incidentId, [...incidentIds])) : polled
    );
}

/** Tracked incidents per phase, with `0` for phases that have none. */
export async function countIncidentsByPhase(
  db: Executor
): Promise<Record<IncidentSyncPhase, number>> {
  const rows = await db
    .select({ phase: incidentSyncState.phase, count: count() })
    .from(incidentSyncState)
    .groupBy(incidentSyncState.phase);
  const counts = Object.fromEntries(INCIDENT_SYNC_PHASES.map((phase) => [phase, 0])) as Record<
    IncidentSyncPhase,
    number
  >;
  for (const row of rows) counts[row.phase] = row.count;
  return counts;
}
