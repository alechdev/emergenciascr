import { incidentTimestamp } from "@bomberoscr/sync-domain/normalize";

import type { IncidentListItem } from "@bomberoscr/sigae/client";

const HOUR_MS = 60 * 60 * 1000;

/** How far back the gap fill looks (spec section 8.1). */
export const GAP_FILL_WINDOW_MS = 6 * HOUR_MS;

/** One pending poll job per incident. BullMQ job IDs can't contain `:`. */
export function incidentPollJobId(incidentId: number): string {
  return `incident-poll-${incidentId}`;
}

/** A poll to schedule. */
export interface PollRequest {
  incidentId: number;
  /** When it is due; in the past or `null` means right away. */
  at: Date | null;
}

/** Milliseconds until a poll is due, never negative. */
export function pollDelayMs(at: Date | null, now: Date): number {
  return at === null ? 0 : Math.max(0, at.getTime() - now.getTime());
}

/** How late a poll started, in seconds (`sync.poll.lag`). `null` when it wasn't scheduled. */
export function pollLagSeconds(scheduledAt: Date | null, startedAt: Date): number | null {
  if (scheduledAt === null) return null;
  return Math.max(0, startedAt.getTime() - scheduledAt.getTime()) / 1000;
}

/** The incident time of a list item, like the report's (`fecha` date, `horaIncidente` time). */
export function listedIncidentTime(item: Pick<IncidentListItem, "fecha" | "horaIncidente">) {
  return incidentTimestamp(item.fecha, item.horaIncidente, {
    entity: "incident",
    entityId: 0,
    issues: []
  });
}

/** `sync.discovery.delay`: first seen minus SIGAE's incident time, in seconds. */
export function discoveryDelaySeconds(reportedAt: Date | null, firstSeenAt: Date): number | null {
  if (reportedAt === null) return null;
  return Math.max(0, firstSeenAt.getTime() - reportedAt.getTime()) / 1000;
}

/** The dates to ask SIGAE for, and the oldest incident time the gap fill keeps. */
export function gapFillRange(now: Date): { from: Date; to: Date; since: Date } {
  const since = new Date(now.getTime() - GAP_FILL_WINDOW_MS);
  return { from: since, to: now, since };
}

/**
 * Incidents from the gap fill list within the window. Items without a usable time are kept:
 * tracking one too many is cheap, missing one is not.
 */
export function withinGapFill<T extends Pick<IncidentListItem, "fecha" | "horaIncidente">>(
  items: readonly T[],
  since: Date
): T[] {
  return items.filter((item) => {
    const time = listedIncidentTime(item);
    return time === null || time >= since;
  });
}

/** When to poll an incident again, or `null` once the lifecycle stopped polling it. */
export function nextPollFor(state: { phase: string; nextPollAt: Date | null }): Date | null {
  return state.phase === "active" || state.phase === "settling" ? state.nextPollAt : null;
}
