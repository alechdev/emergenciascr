import {
  type SyncIncidentDeps,
  type SyncIncidentOutcome,
  describeError,
  syncIncident
} from "@bomberoscr/sync-domain/pipeline";
import { type Span, SpanStatusCode, type Tracer, trace } from "@opentelemetry/api";

import logger from "@/lib/logger";
import { anomaliesDetected, changesDetected, pollLag, pollResults } from "@/lib/metrics";
import { pollSummary } from "@/lib/poll-summary";
import { pollLagSeconds } from "@/lib/schedule";

import type winston from "winston";

export type PollDeps = Omit<SyncIncidentDeps, "span"> & {
  tracer?: Tracer;
  log?: winston.Logger;
};

/**
 * One poll with its telemetry (spec section 4.2): a `sync.poll` span around the SIGAE
 * requests and the database transaction, poll, change and anomaly metrics, and one summary
 * log line. Incident IDs go in the span and the log, never in metric attributes.
 */
export async function pollIncident(
  deps: PollDeps,
  job: { incidentId: number; jobId?: string }
): Promise<SyncIncidentOutcome> {
  const tracer = deps.tracer ?? trace.getTracer("sync-v2");
  const log = deps.log ?? logger;
  const { incidentId } = job;

  return tracer.startActiveSpan(
    "sync.poll",
    { attributes: { "sync.incident_id": incidentId } },
    async (span) => {
      const startedAt = performance.now();
      try {
        const outcome = await syncIncident(
          { ...deps, span: (name, step) => inSpan(tracer, name, step) },
          incidentId
        );
        span.setAttributes({
          "sync.poll.result": outcome.kind,
          "sync.poll.phase": outcome.syncState.phase,
          "sync.poll.changes": outcome.changes.length,
          "sync.poll.anomalies": outcome.anomalies.length
        });
        if (outcome.kind === "failed") {
          span.setStatus({ code: SpanStatusCode.ERROR, message: outcome.reason ?? "failed" });
        }
        recordPollMetrics(outcome);

        const references = outcome.references;
        if (references) {
          const { fetched, failures } = references;
          if (
            fetched.stations.length > 0 ||
            fetched.vehicles.length > 0 ||
            fetched.incidentTypes !== null
          ) {
            log.info("references fetched on demand", { incidentId, jobId: job.jobId, ...fetched });
          }
          if (failures.length > 0) {
            log.info("references unavailable", { incidentId, jobId: job.jobId, failures });
          }
        }
        const summary = pollSummary(outcome, {
          jobId: job.jobId,
          durationMs: performance.now() - startedAt
        });
        log[summary.level](summary.message, summary.fields);
        return outcome;
      } catch (error) {
        recordError(span, error);
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

export function recordPollMetrics(outcome: SyncIncidentOutcome): void {
  if (outcome.kind === "skipped") return;
  pollResults.add(1, { result: outcome.kind });
  const lag = pollLagSeconds(outcome.scheduledAt, outcome.startedAt);
  if (lag !== null) pollLag.record(lag);
  for (const change of outcome.changes) {
    changesDetected.add(1, { entity: change.entity, field: change.field, kind: change.kind });
  }
  for (const anomaly of outcome.anomalies) {
    anomaliesDetected.add(1, { code: anomaly.code });
  }
}

async function inSpan<T>(tracer: Tracer, name: string, step: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await step();
    } catch (error) {
      recordError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Database errors carry row values in their message; spans get the redacted chain. */
function recordError(span: Span, error: unknown): void {
  const message = describeError(error);
  span.recordException({ name: error instanceof Error ? error.name : "Error", message });
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}
