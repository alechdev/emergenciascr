import { createQueue, removeFinishedJob } from "@/lib/jobs";
import { type PollRequest, incidentPollJobId, pollDelayMs } from "@/lib/schedule";

import type { Queue } from "bullmq";

export interface IncidentPollJobData {
  incidentId: number;
}

export const INCIDENT_POLL_JOB_NAME = "incident-poll";

/**
 * One job per tracked incident, moved back to delayed until its next poll. Failed polls are
 * counted by the lifecycle in `incident_sync_state`; attempts only cover errors that kept
 * the poll from saving its sync state (the database being down).
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
      // A finished job with the same ID would make the new one a silent duplicate.
      await Promise.all(
        requests.map((request) =>
          removeFinishedJob(queue as Queue, incidentPollJobId(request.incidentId))
        )
      );
      const at = now();
      const jobs = await queue.addBulk(
        requests.map((request) => ({
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
