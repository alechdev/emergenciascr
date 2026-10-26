import type { ClosedAtSource, DispatchedVehicleRow, IncidentRow, SyncState } from "../types";

const MINUTE_MS = 60_000;

/**
 * The longest gap since the previous successful poll that still counts as "seen closing":
 * twice the scheduled interval, and never less than this.
 */
const MIN_OBSERVED_GAP_MS = 15 * MINUTE_MS;

export interface ClosedAt {
  closedAt: Date | null;
  closedAtSource: ClosedAtSource | null;
}

export interface ClosedAtInput {
  /** The stored incident before this poll. */
  previous: Pick<IncidentRow, "isOpen" | "closedAt" | "closedAtSource"> | null;
  isOpen: boolean;
  controlledAt: Date | null;
  vehicles: readonly DispatchedVehicleRow[];
  /** The sync state before this poll. */
  syncState: SyncState;
  now: Date;
}

/**
 * Spec section 8.3.
 *
 * - Open: no `closedAt`.
 * - Seen open on the previous poll, closed now: the time of this poll, `observed`. It stays
 *   fixed while the incident remains closed.
 * - Otherwise (closed when first seen, or the sync wasn't polling): the latest unit
 *   departure, else `controlledAt`, else when the sync first saw it; `estimated`, and
 *   recomputed on every poll as late data arrives.
 */
export function resolveClosedAt(input: ClosedAtInput): ClosedAt {
  const { previous } = input;
  if (input.isOpen) return { closedAt: null, closedAtSource: null };

  if (previous && !previous.isOpen && previous.closedAtSource === "observed" && previous.closedAt) {
    return { closedAt: previous.closedAt, closedAtSource: "observed" };
  }
  if (previous?.isOpen && wasPollingClosely(input.syncState, input.now)) {
    return { closedAt: input.now, closedAtSource: "observed" };
  }
  return { closedAt: estimateClosedAt(input), closedAtSource: "estimated" };
}

function wasPollingClosely(state: SyncState, now: Date): boolean {
  if (state.lastPolledAt === null || state.consecutiveFailures > 0 || state.notFoundCount > 0) {
    return false;
  }
  const scheduledGap =
    state.nextPollAt === null ? 0 : state.nextPollAt.getTime() - state.lastPolledAt.getTime();
  const maxGap = Math.max(2 * scheduledGap, MIN_OBSERVED_GAP_MS);
  return now.getTime() - state.lastPolledAt.getTime() <= maxGap;
}

function estimateClosedAt({ vehicles, controlledAt, syncState }: ClosedAtInput): Date {
  let latestDeparture: Date | null = null;
  for (const vehicle of vehicles) {
    if (vehicle.departureTime && (!latestDeparture || vehicle.departureTime > latestDeparture)) {
      latestDeparture = vehicle.departureTime;
    }
  }
  return latestDeparture ?? controlledAt ?? syncState.firstSeenAt;
}
