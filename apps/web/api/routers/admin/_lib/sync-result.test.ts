import { describe, expect, it } from "vitest";

import { syncResult } from "./sync-result";

import type { SyncIncidentOutcome } from "@bomberoscr/sync-domain/pipeline";

function outcome(overrides: Partial<SyncIncidentOutcome>): SyncIncidentOutcome {
  const at = new Date("2026-10-16T12:00:00Z");
  return {
    incidentId: 42,
    kind: "ok",
    reason: null,
    changes: [],
    anomalies: [],
    syncState: {
      incidentId: 42,
      phase: "active",
      nextPollAt: null,
      lastPolledAt: at,
      upstreamClosedAt: null,
      consecutiveFailures: 0,
      notFoundCount: 0,
      emptyUnitsCount: 0,
      lastError: null,
      firstSeenAt: at
    },
    scheduledAt: null,
    startedAt: at,
    polledAt: at,
    deleted: false,
    snapshots: null,
    references: null,
    ...overrides
  };
}

describe("syncResult", () => {
  it("reports successful and partial polls as synced", () => {
    expect(syncResult(outcome({ kind: "ok" }))).toEqual({ incidentId: 42, success: true });
    expect(syncResult(outcome({ kind: "partial" }))).toEqual({ incidentId: 42, success: true });
  });

  it("tells not found apart from deleted and already deleted", () => {
    expect(syncResult(outcome({ kind: "not_found" }))).toMatchObject({
      success: false,
      error: "Incident not found in SIGAE"
    });
    expect(syncResult(outcome({ kind: "not_found", deleted: true }))).toMatchObject({
      success: false,
      error: "Incident not found in SIGAE; deleted"
    });
    expect(syncResult(outcome({ kind: "skipped", reason: "already deleted" }))).toMatchObject({
      success: false,
      error: "Incident not found in SIGAE; already deleted"
    });
  });

  it("counts a poll superseded by a newer one as synced", () => {
    expect(syncResult(outcome({ kind: "skipped", reason: "superseded by a newer poll" }))).toEqual({
      incidentId: 42,
      success: true
    });
  });

  it("passes the failure reason on", () => {
    expect(
      syncResult(outcome({ kind: "failed", reason: "ObtenerDetalleEmergencias: timeout" }))
    ).toEqual({ incidentId: 42, success: false, error: "ObtenerDetalleEmergencias: timeout" });
  });
});
