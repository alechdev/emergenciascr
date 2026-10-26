import { DelayedError } from "bullmq";

import { RetryLaterError, createWorker } from "@/lib/jobs";
import logger from "@/lib/logger";
import { infraRetryDelayMs, nextPollFor } from "@/lib/schedule";
import { type IncidentPollJobData, incidentPollQueue } from "@/queues/incidentPoll.queue";
import { type PollDeps, pollIncident } from "@/services/incidentPoll.service";

import type { IncidentSyncPhase } from "@bomberoscr/sync-domain/types";

export interface IncidentPollResult {
  incidentId: number;
  result: string;
  phase: IncidentSyncPhase;
}

/**
 * Stalls a poll job may have before BullMQ fails it for good. A poll stalls when its worker
 * dies or blocks mid-poll; polling again is safe (the incident lock and the superseded
 * check keep it consistent), so a few restarts in a row shouldn't drop the incident.
 */
export const POLL_MAX_STALLED_COUNT = 5;

const log = logger.child({ queue: incidentPollQueue.name });

/**
 * Polls one incident and moves the same job back to delayed until `nextPollAt`, so each
 * incident has at most one pending job (`incident-poll-<id>`). The job completes once the
 * lifecycle stops polling the incident (`done`, `deleted` or `failed`).
 *
 * A poll that throws couldn't load or save the sync state (the database is down): the job
 * is moved back to delayed with a backoff instead of failing, so an outage doesn't spend
 * the job's attempts and drop the incident's polls. The retry count lives in the job data
 * until a poll gets through. Only an error moving the job (Redis is down too) is thrown.
 */
export function createIncidentPollWorker(deps: PollDeps) {
  return createWorker<IncidentPollJobData, IncidentPollResult>(
    incidentPollQueue.name,
    async (job, token) => {
      const { incidentId } = job.data;
      let outcome: Awaited<ReturnType<typeof pollIncident>>;
      try {
        outcome = await pollIncident(deps, { incidentId, jobId: job.id });
      } catch (error) {
        const retries = (job.data.retries ?? 0) + 1;
        const delayMs = infraRetryDelayMs(retries);
        log.warn("poll failed before saving its sync state, retrying later", {
          incidentId,
          jobId: job.id,
          retries,
          delayMs,
          error
        });
        await job.updateData({ incidentId, retries });
        await job.moveToDelayed(Date.now() + delayMs, token);
        throw new RetryLaterError();
      }
      if (job.data.retries) await job.updateData({ incidentId });

      const next = nextPollFor(outcome.syncState);
      if (next) {
        await job.moveToDelayed(Math.max(next.getTime(), Date.now()), token);
        throw new DelayedError();
      }
      return {
        incidentId: outcome.incidentId,
        result: outcome.kind,
        phase: outcome.syncState.phase
      };
    },
    { concurrency: 5, maxStalledCount: POLL_MAX_STALLED_COUNT }
  );
}
