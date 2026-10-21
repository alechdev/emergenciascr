import type { Anomaly, SyncState } from "../types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Spec section 8.2. */
export const LIFECYCLE = {
  activeInterval: 3 * MINUTE_MS,
  /** Open incidents are polled hourly once open for longer than this. */
  longOpenAfter: 72 * HOUR_MS,
  longOpenInterval: HOUR_MS,
  /** Open incidents stop being polled after this (`OPEN_TOO_LONG`). */
  openCap: 30 * DAY_MS,
  settlingEarlyInterval: 15 * MINUTE_MS,
  settlingEarlyWindow: 6 * HOUR_MS,
  settlingLateInterval: HOUR_MS,
  /** How long a closed incident keeps being polled after SIGAE closed it. */
  settlingWindow: 72 * HOUR_MS,
  maxConsecutiveFailures: 10,
  failureBackoffBase: 3 * MINUTE_MS,
  failureBackoffMax: HOUR_MS,
  notFoundPollsBeforeDelete: 2,
  notFoundMinGap: 3 * MINUTE_MS
} as const;

/** What a poll told the lifecycle. */
export type LifecycleOutcome =
  | { kind: "ok" | "partial"; isOpen: boolean; incidentTimestamp: Date }
  | { kind: "not_found" }
  | { kind: "failed"; reason: string };

export interface LifecycleDecision {
  state: SyncState;
  /** The not-found flow decided the incident is gone upstream (section 8.4). */
  deleteIncident: boolean;
  anomalies: Anomaly[];
}

/**
 * The sync state after a poll: phase, next poll time and counters (sections 8.2 and 8.4).
 * `isOpen` always comes from SIGAE; the sync never closes an incident on its own.
 */
export function nextPoll(
  state: SyncState,
  outcome: LifecycleOutcome,
  now: Date
): LifecycleDecision {
  const polled: SyncState = { ...state, lastPolledAt: now };
  switch (outcome.kind) {
    case "ok":
    case "partial":
      return afterSuccess(
        { ...polled, consecutiveFailures: 0, notFoundCount: 0, lastError: null },
        outcome.isOpen,
        outcome.incidentTimestamp,
        now
      );
    case "not_found":
      return afterNotFound(state, { ...polled, consecutiveFailures: 0, lastError: null }, now);
    case "failed":
      return afterFailure({ ...polled, notFoundCount: 0, lastError: outcome.reason }, now);
  }
}

function afterSuccess(
  state: SyncState,
  isOpen: boolean,
  incidentTimestamp: Date,
  now: Date
): LifecycleDecision {
  const nowMs = now.getTime();

  if (isOpen) {
    const capAt = incidentTimestamp.getTime() + LIFECYCLE.openCap;
    if (nowMs >= capAt) {
      return {
        state: { ...state, phase: "done", nextPollAt: null, upstreamClosedAt: null },
        deleteIncident: false,
        anomalies: [
          {
            code: "OPEN_TOO_LONG",
            entity: "incident",
            entityId: state.incidentId,
            details: { incidentTimestamp: incidentTimestamp.toISOString() }
          }
        ]
      };
    }
    const openFor = nowMs - incidentTimestamp.getTime();
    const interval =
      openFor > LIFECYCLE.longOpenAfter ? LIFECYCLE.longOpenInterval : LIFECYCLE.activeInterval;
    return {
      state: {
        ...state,
        phase: "active",
        nextPollAt: new Date(Math.min(nowMs + interval, capAt)),
        upstreamClosedAt: null
      },
      deleteIncident: false,
      anomalies: []
    };
  }

  const upstreamClosedAt = state.upstreamClosedAt ?? now;
  const settleUntil = upstreamClosedAt.getTime() + LIFECYCLE.settlingWindow;
  if (nowMs >= settleUntil) {
    return {
      state: { ...state, phase: "done", nextPollAt: null, upstreamClosedAt },
      deleteIncident: false,
      anomalies: []
    };
  }
  const closedFor = nowMs - upstreamClosedAt.getTime();
  const interval =
    closedFor < LIFECYCLE.settlingEarlyWindow
      ? LIFECYCLE.settlingEarlyInterval
      : LIFECYCLE.settlingLateInterval;
  return {
    state: {
      ...state,
      phase: "settling",
      nextPollAt: new Date(Math.min(nowMs + interval, settleUntil)),
      upstreamClosedAt
    },
    deleteIncident: false,
    anomalies: []
  };
}

/**
 * Two consecutive not-found polls at least {@link LIFECYCLE.notFoundMinGap} apart delete the
 * incident. A repeat sooner than that doesn't count, so a quick retry can't delete it.
 */
function afterNotFound(previous: SyncState, state: SyncState, now: Date): LifecycleDecision {
  const gapMs =
    previous.lastPolledAt === null ? Infinity : now.getTime() - previous.lastPolledAt.getTime();
  const notFoundCount =
    previous.notFoundCount === 0
      ? 1
      : gapMs >= LIFECYCLE.notFoundMinGap
        ? previous.notFoundCount + 1
        : previous.notFoundCount;

  if (notFoundCount >= LIFECYCLE.notFoundPollsBeforeDelete) {
    return {
      state: { ...state, phase: "deleted", nextPollAt: null, notFoundCount },
      deleteIncident: true,
      anomalies: [
        {
          code: "INCIDENT_DELETED_UPSTREAM",
          entity: "incident",
          entityId: state.incidentId,
          details: { notFoundPolls: notFoundCount }
        }
      ]
    };
  }
  return {
    state: {
      ...state,
      notFoundCount,
      nextPollAt: new Date(now.getTime() + LIFECYCLE.notFoundMinGap)
    },
    deleteIncident: false,
    anomalies: []
  };
}

/** Exponential backoff from 3 minutes up to an hour; `failed` after 10 in a row. */
function afterFailure(state: SyncState, now: Date): LifecycleDecision {
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (consecutiveFailures >= LIFECYCLE.maxConsecutiveFailures) {
    return {
      state: { ...state, phase: "failed", nextPollAt: null, consecutiveFailures },
      deleteIncident: false,
      anomalies: []
    };
  }
  const delay = Math.min(
    LIFECYCLE.failureBackoffBase * 2 ** (consecutiveFailures - 1),
    LIFECYCLE.failureBackoffMax
  );
  return {
    state: { ...state, consecutiveFailures, nextPollAt: new Date(now.getTime() + delay) },
    deleteIncident: false,
    anomalies: []
  };
}
