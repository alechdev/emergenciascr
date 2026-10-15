import {
  DelayedError,
  type Job,
  type JobsOptions,
  Queue,
  WaitingChildrenError,
  Worker
} from "bullmq";
import { BullMQOtel } from "bullmq-otel";

import { redis } from "@/config/redis";
import logger from "@/lib/logger";
import { jobDuration } from "@/lib/metrics";

const TRACER_NAME = "sync-v2";

/** Every queue sets an attempt limit, so no job is retried forever. */
export type QueueJobOptions = JobsOptions & { attempts: number };

export function createQueue<Data = unknown>(
  name: string,
  defaultJobOptions: QueueJobOptions
): Queue<Data> {
  return new Queue<Data>(name, {
    connection: redis,
    telemetry: new BullMQOtel(TRACER_NAME),
    defaultJobOptions
  });
}

export type JobProcessor<Data, Result> = (job: Job<Data>, token?: string) => Promise<Result>;

/**
 * A worker that records `sync.job.duration` and logs failures with their cause chain:
 * `warn` while the job has attempts left, `error` on its last one.
 */
export function createWorker<Data, Result>(
  name: string,
  processor: JobProcessor<Data, Result>,
  options: { concurrency: number }
): Worker<Data, Result> {
  const log = logger.child({ queue: name });

  const worker = new Worker<Data, Result>(
    name,
    async (job, token) => {
      const startedAt = performance.now();
      let outcome = "failed";
      try {
        const result = await processor(job, token);
        outcome = "completed";
        return result;
      } catch (error) {
        if (error instanceof DelayedError || error instanceof WaitingChildrenError) {
          outcome = "delayed";
        }
        throw error;
      } finally {
        jobDuration.record((performance.now() - startedAt) / 1000, { queue: name, outcome });
      }
    },
    {
      connection: redis,
      telemetry: new BullMQOtel(TRACER_NAME),
      concurrency: options.concurrency
    }
  );

  worker.on("failed", (job, error) => {
    const attempts = job?.opts.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? attempts;
    const final = attemptsMade >= attempts;
    log[final ? "error" : "warn"](final ? "job failed" : "job attempt failed", {
      jobId: job?.id,
      jobName: job?.name,
      attemptsMade,
      attempts,
      error
    });
  });
  worker.on("stalled", (jobId) => {
    log.warn("job stalled", { jobId });
  });
  worker.on("error", (error) => {
    log.error("worker error", { error });
  });

  return worker;
}

/**
 * Removes a finished job with this ID, so adding the ID again creates a new job instead of
 * being ignored as a duplicate. Waiting, delayed and active jobs are left alone.
 */
export async function removeFinishedJob(queue: Queue, jobId: string): Promise<void> {
  const job = await queue.getJob(jobId);
  if (!job) return;
  const state = await job.getState();
  if (state === "completed" || state === "failed") await job.remove();
}
