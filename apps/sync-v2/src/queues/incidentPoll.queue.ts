import { createQueue, removeFinishedJob } from "@/lib/jobs";
import { type PollRequest, incidentPollJobId, pollDelayMs } from "@/lib/schedule";

import type { Queue } from "bullmq";

export interface IncidentPollJobData {
  incidentId: number;
  /** Polls in a row that threw (see `createIncidentPollWorker`); unset after one gets through. */
  retries?: number;
}

export const INCIDENT_POLL_JOB_NAME = "incident-poll";

/**
 * One job per tracked incident, moved back to delayed until its next poll. Failed polls are
 * counted by the lifecycle in `incident_sync_state`, and polls that couldn't save it are
 * delayed with a backoff by the worker; attempts only cover errors moving the job itself
 * (Redis being down).
 */
export const incidentPollQueue = createQueue<IncidentPollJobData>("incident-poll", {
  removeOnComplete: 100,
  removeOnFail: 100,
  attempts: 3,
  backoff: { type: "exponential", delay: 60 * 1000 }
});

/** Schedules polls, at most one pending job per incident. */
export interface PollScheduler {
  /** Returns how many jobs were added; incidents with a pending job keep it. */
  schedule(requests: readonly PollRequest[]): Promise<number>;
}

export function createPollScheduler(
  queue: Queue<IncidentPollJobData> = incidentPollQueue,
  now: () => Date = () => new Date()
): PollScheduler {
  return {
    async schedule(requests) {
      if (requests.length === 0) return 0;
      // A finished job with the same ID would make the new one a silent duplicate, and
      // `addBulk` returns pending ones as if it had added them.
      const pending = await Promise.all(
        requests.map((request) =>
          removeFinishedJob(queue as Queue, incidentPollJobId(request.incidentId))
        )
      );
      const missing = requests.filter((_, index) => !pending[index]);
      if (missing.length === 0) return 0;
      const at = now();
      const jobs = await queue.addBulk(
        missing.map((request) => ({
          name: INCIDENT_POLL_JOB_NAME,
          data: { incidentId: request.incidentId },
          opts: {
            jobId: incidentPollJobId(request.incidentId),
            delay: pollDelayMs(request.at, at)
          }
        }))
      );
      return jobs.length;
    }
  };
}
