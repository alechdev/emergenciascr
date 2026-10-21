import {
  type ScheduledIncident,
  listPolledIncidents,
  trackNewIncidents
} from "@bomberoscr/sync-domain/persist";

import { SyncError } from "@/lib/errors";
import { discoveryDelay, incidentsDiscovered } from "@/lib/metrics";
import {
  discoveryDelaySeconds,
  gapFillRange,
  listedIncidentTime,
  withinGapFill
} from "@/lib/schedule";
import { expectOk } from "@/lib/sigae";

import type { PollScheduler } from "@/queues/incidentPoll.queue";
import type { Database } from "@bomberoscr/db/client";
import type { IncidentListItem, SigaeClient } from "@bomberoscr/sigae/client";

const LATEST_INCIDENTS = 50;

export interface DiscoveryDeps {
  db: Database;
  sigae: Pick<SigaeClient, "getLatestIncidents" | "getIncidentsBetween">;
  scheduler: PollScheduler;
  now: () => Date;
}

export interface DiscoveryResult {
  /** Incidents in the SIGAE list. */
  listed: number;
  /** Incidents tracked for the first time. */
  discovered: number[];
  /** Listed incidents already polled whose poll job was missing and was added again. */
  rescheduled: number;
}

/** Every minute: the latest 50 incidents (spec section 8.1). */
export async function discoverLatestIncidents(deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const list = await expectOk(
    deps.sigae.getLatestIncidents({ count: LATEST_INCIDENTS }),
    "latest incidents"
  );
  if (list.isErr()) throw list.error;
  return track(deps, list.value.items);
}

/** At boot and hourly: incidents reported in the last 6 hours (spec section 8.1). */
export async function fillDiscoveryGap(deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const { from, to, since } = gapFillRange(deps.now());
  const list = await expectOk(deps.sigae.getIncidentsBetween({ from, to }), "incidents between");
  if (list.isErr()) throw list.error;
  return track(deps, withinGapFill(list.value.items, since));
}

/**
 * Schedules a poll for every `active` and `settling` incident, so losing Redis never loses a
 * tracked incident (spec section 8.1). Incidents that still have a pending job keep it.
 */
export async function resumePolledIncidents(
  deps: Pick<DiscoveryDeps, "db" | "scheduler">
): Promise<{ tracked: number; scheduled: number }> {
  const tracked = await listPolledIncidents(deps.db);
  const scheduled = await deps.scheduler.schedule(
    tracked.map((row) => ({ incidentId: row.incidentId, at: row.nextPollAt }))
  );
  return { tracked: tracked.length, scheduled };
}

/**
 * New incidents get an `incident_sync_state` row and a poll right away. Listed incidents
 * that are already polled (`active`, `settling`) get their poll back if their job is gone
 * (it failed for good, or Redis lost it), without waiting for the hourly resume; the ones
 * with a pending job keep it.
 */
async function track(
  deps: DiscoveryDeps,
  items: readonly IncidentListItem[]
): Promise<DiscoveryResult> {
  const firstSeenAt = deps.now();
  const byId = new Map(items.map((item) => [item.idBoletaIncidente, item]));
  let discovered: number[];
  try {
    discovered = await trackNewIncidents(
      deps.db,
      [...byId.keys()].map((incidentId) => ({ incidentId, firstSeenAt }))
    );
  } catch (cause) {
    throw new SyncError("failed to store discovered incidents", { cause });
  }
  // Recorded before scheduling: once stored, these incidents are never new again.
  incidentsDiscovered.add(discovered.length);
  for (const incidentId of discovered) {
    const item = byId.get(incidentId);
    const delay = item ? discoveryDelaySeconds(listedIncidentTime(item), firstSeenAt) : null;
    if (delay !== null) discoveryDelay.record(delay);
  }

  if (discovered.length > 0) {
    await deps.scheduler.schedule(discovered.map((incidentId) => ({ incidentId, at: null })));
  }
  const isNew = new Set(discovered);
  let polled: ScheduledIncident[];
  try {
    polled = await listPolledIncidents(
      deps.db,
      [...byId.keys()].filter((incidentId) => !isNew.has(incidentId))
    );
  } catch (cause) {
    throw new SyncError("failed to load tracked incidents", { cause });
  }
  const rescheduled = await deps.scheduler.schedule(
    polled.map((row) => ({ incidentId: row.incidentId, at: row.nextPollAt }))
  );
  return { listed: byId.size, discovered, rescheduled };
}
