import type { SyncIncidentOutcome } from "@bomberoscr/sync-domain/pipeline";

export interface PollSummary {
  level: "info" | "warn";
  message: string;
  fields: Record<string, unknown>;
}

/**
 * The one log line per poll (spec section 4.2): result, change count, anomaly codes and the
 * next poll time. A failed poll is `warn`; anomalies are `info`, they are counted in metrics.
 * Never includes SIGAE bodies.
 */
export function pollSummary(
  outcome: SyncIncidentOutcome,
  context: { jobId?: string; durationMs: number }
): PollSummary {
  const { syncState } = outcome;
  const fields: Record<string, unknown> = {
    incidentId: outcome.incidentId,
    jobId: context.jobId,
    result: outcome.kind,
    phase: syncState.phase,
    changes: outcome.changes.length,
    anomalies: outcome.anomalies.map((anomaly) => anomaly.code),
    nextPollAt: syncState.nextPollAt?.toISOString() ?? null,
    durationMs: Math.round(context.durationMs)
  };
  if (outcome.kind === "failed") {
    fields.reason = outcome.reason;
    fields.consecutiveFailures = syncState.consecutiveFailures;
  }
  if (outcome.kind === "not_found") fields.notFoundCount = syncState.notFoundCount;
  if (outcome.deleted) fields.deleted = true;
  if (outcome.error !== undefined) fields.error = outcome.error;

  return {
    level: outcome.kind === "failed" ? "warn" : "info",
    message: outcome.kind === "skipped" ? "incident no longer polled" : "incident polled",
    fields
  };
}
