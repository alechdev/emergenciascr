import { describe, expect, it } from "vitest";

import { pollSummary } from "@/lib/poll-summary";

import type { SyncIncidentOutcome } from "@bomberoscr/sync-domain/pipeline";
import type { SyncState } from "@bomberoscr/sync-domain/types";

const polledAt = new Date("2026-10-11T02:30:00.000Z");

function syncState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    incidentId: 1900001,
    phase: "active",
    nextPollAt: new Date("2026-10-11T02:33:00.000Z"),
    lastPolledAt: polledAt,
    upstreamClosedAt: null,
    consecutiveFailures: 0,
    notFoundCount: 0,
    emptyUnitsCount: 0,
    lastError: null,
    firstSeenAt: polledAt,
    ...overrides
  };
}

function outcome(overrides: Partial<SyncIncidentOutcome> = {}): SyncIncidentOutcome {
  return {
    incidentId: 1900001,
    kind: "ok",
    reason: null,
    changes: [],
    anomalies: [],
    syncState: syncState(),
    scheduledAt: null,
    startedAt: polledAt,
    polledAt,
    deleted: false,
    snapshots: null,
    references: null,
    ...overrides
  };
}

describe("pollSummary", () => {
  it("logs result, change count, anomaly codes and the next poll as info", () => {
    const summary = pollSummary(
      outcome({
        kind: "partial",
        changes: [
          {
            entity: "incident",
            entityId: 1900001,
            field: "latitude",
            kind: "set",
            oldValue: "0",
            newValue: "9.9"
          }
        ],
        anomalies: [
          {
            code: "UPSTREAM_PARTIAL_REPORT",
            entity: "incident",
            entityId: 1900001,
            details: { description: "Specified cast is not valid." }
          }
        ]
      }),
      { jobId: "incident-poll-1900001", durationMs: 812.4 }
    );

    expect(summary).toEqual({
      level: "info",
      message: "incident polled",
      fields: {
        incidentId: 1900001,
        jobId: "incident-poll-1900001",
        result: "partial",
        phase: "active",
        changes: 1,
        anomalies: ["UPSTREAM_PARTIAL_REPORT"],
        nextPollAt: "2026-10-11T02:33:00.000Z",
        durationMs: 812
      }
    });
  });

  it("logs a failed poll as warn with its reason", () => {
    const summary = pollSummary(
      outcome({
        kind: "failed",
        reason: "ObtenerBoletaIncidente request failed (timeout): timed out",
        syncState: syncState({ consecutiveFailures: 2 })
      }),
      { durationMs: 15_000 }
    );

    expect(summary.level).toBe("warn");
    expect(summary.fields).toMatchObject({
      result: "failed",
      reason: "ObtenerBoletaIncidente request failed (timeout): timed out",
      consecutiveFailures: 2
    });
  });

  it("marks a deletion and the end of polling", () => {
    const summary = pollSummary(
      outcome({
        kind: "not_found",
        deleted: true,
        syncState: syncState({ phase: "deleted", nextPollAt: null, notFoundCount: 2 })
      }),
      { durationMs: 100 }
    );

    expect(summary.level).toBe("info");
    expect(summary.fields).toMatchObject({
      result: "not_found",
      phase: "deleted",
      nextPollAt: null,
      notFoundCount: 2,
      deleted: true
    });
  });

  it("says when an incident is no longer polled", () => {
    const summary = pollSummary(
      outcome({ kind: "skipped", syncState: syncState({ phase: "done", nextPollAt: null }) }),
      { durationMs: 3 }
    );
    expect(summary.message).toBe("incident no longer polled");
  });

  it("says when a newer poll superseded this one", () => {
    const summary = pollSummary(
      outcome({ kind: "skipped", reason: "superseded by a newer poll", syncState: syncState() }),
      { durationMs: 3 }
    );
    expect(summary.message).toBe("incident poll superseded");
    expect(summary.fields.reason).toBe("superseded by a newer poll");
  });
});
