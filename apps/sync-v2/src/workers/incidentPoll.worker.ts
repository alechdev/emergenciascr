import { DelayedError } from "bullmq";

import { createWorker } from "@/lib/jobs";
import { nextPollFor } from "@/lib/schedule";
import { type IncidentPollJobData, incidentPollQueue } from "@/queues/incidentPoll.queue";
import { type PollDeps, pollIncident } from "@/services/incidentPoll.service";

import type { IncidentSyncPhase } from "@bomberoscr/sync-domain/types";

export interface IncidentPollResult {
  incidentId: number;
  result: string;
  phase: IncidentSyncPhase;
}

/**
 * Polls one incident and moves the same job back to delayed until `nextPollAt`, so each
 * incident has at most one pending job (`incident-poll-<id>`). The job completes once the
 * lifecycle stops polling the incident (`done`, `deleted` or `failed`).
 */
export function createIncidentPollWorker(deps: PollDeps) {
  return createWorker<IncidentPollJobData, IncidentPollResult>(
    incidentPollQueue.name,
    async (job, token) => {
      const outcome = await pollIncident(deps, {
        incidentId: job.data.incidentId,
        jobId: job.id
      });
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
    { concurrency: 5 }
  );
}
