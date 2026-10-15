import { type Attributes, type ObservableCallback, metrics } from "@opentelemetry/api";

import type { Queue } from "bullmq";

/**
 * Sync metrics (spec section 4.2). No incident IDs in attributes, to keep cardinality
 * bounded; those go in logs and spans. Durations are in seconds.
 *
 * Instruments are created when this module is first imported, which must be after
 * telemetry started (see `instrumentation.ts`).
 */
const meter = metrics.getMeter("sync-v2");

export const jobDuration = meter.createHistogram("sync.job.duration", {
  description: "Job processing time by queue and outcome",
  unit: "s",
  advice: { explicitBucketBoundaries: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 900] }
});

export const incidentsDiscovered = meter.createCounter("sync.incidents.discovered", {
  description: "Incidents seen for the first time by discovery"
});

const referenceLastSuccess = new Map<string, number>();

meter
  .createObservableGauge("sync.reference.last_success", {
    description: "Unix time of the last successful reference sync, by kind",
    unit: "s"
  })
  .addCallback((result) => {
    for (const [kind, seconds] of referenceLastSuccess) result.observe(seconds, { kind });
  });

export function recordReferenceSuccess(kind: string, at = Date.now()): void {
  referenceLastSuccess.set(kind, Math.floor(at / 1000));
}

const QUEUE_STATES = [
  "waiting",
  "active",
  "delayed",
  "prioritized",
  "waiting-children",
  "completed",
  "failed"
] as const;

/**
 * Reports BullMQ job counts per queue and state on every metric collection. Call the returned
 * function before closing the queues: the final flush at shutdown collects once more.
 */
export function observeQueues(queues: readonly Queue[]): () => void {
  const gauge = meter.createObservableGauge("sync.queue.jobs", {
    description: "BullMQ jobs by queue and state"
  });
  const callback: ObservableCallback = async (result) => {
    await Promise.all(
      queues.map(async (queue) => {
        try {
          const counts = await queue.getJobCounts(...QUEUE_STATES);
          for (const state of QUEUE_STATES) {
            const attributes: Attributes = { queue: queue.name, state };
            result.observe(counts[state] ?? 0, attributes);
          }
        } catch {
          // Redis unavailable: skip this collection; the health check reports it.
        }
      })
    );
  };
  gauge.addCallback(callback);
  return () => gauge.removeCallback(callback);
}
