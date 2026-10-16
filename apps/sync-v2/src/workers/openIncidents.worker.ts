import { DelayedError, type Job } from "bullmq";

import { SyncError } from "@/lib/errors";
import { createWorker } from "@/lib/jobs";
import logger from "@/lib/logger";
import { type IncidentSyncJobData, openIncidentsQueue } from "@/queues/openIncidents.queue";
import { ERROR_MESSAGES, closeIncident, updateIncident } from "@/services/openIncidents.service";

const REQUEUE_DELAY_MS = 3 * 60 * 1000;
/**
 * After this many consecutive failed polls (the update or the close check) the incident is no
 * longer polled (spec 8.2).
 */
const MAX_FAILED_POLLS = 10;

const log = logger.child({ queue: openIncidentsQueue.name });

export type OpenIncidentResult = { incidentId: number; outcome: "closed" | "given_up" };

/**
 * Updates the incident and closes it once it looks finished. Otherwise the same job is moved
 * back to delayed, so each incident has at most one pending job under `open-incident-<id>`.
 * An incident is only closed right after a successful update, never from stale data.
 */
export function createOpenIncidentsWorker() {
  return createWorker<IncidentSyncJobData, OpenIncidentResult>(
    openIncidentsQueue.name,
    async (job, token): Promise<OpenIncidentResult> => {
      const { incidentId } = job.data;
      const fields = { jobId: job.id, incidentId };

      const failed = async (message: string, error: Error): Promise<OpenIncidentResult> => {
        const failedPolls = (job.data.failedPolls ?? 0) + 1;
        if (failedPolls >= MAX_FAILED_POLLS) {
          log.error("incident no longer polled after failed updates", {
            ...fields,
            failedPolls,
            error
          });
          return { incidentId, outcome: "given_up" };
        }
        log.warn(message, { ...fields, failedPolls, error });
        return requeue(job, token, { failedPolls }, message);
      };

      const update = await updateIncident({ id: incidentId });
      if (update.isErr()) return failed("incident update failed", update.error);

      const close = await closeIncident({ id: incidentId });
      if (close.isOk()) {
        log.info("incident closed", fields);
        return { incidentId, outcome: "closed" };
      }

      const { type, cause } = close.error;
      if (type === "database_error") {
        return failed(
          "incident close check failed",
          new SyncError(`failed to close incident ${incidentId}`, { cause })
        );
      }
      return requeue(job, token, { failedPolls: 0 }, ERROR_MESSAGES[type]);
    },
    { concurrency: 5 }
  );
}

async function requeue(
  job: Job<IncidentSyncJobData>,
  token: string | undefined,
  data: Pick<IncidentSyncJobData, "failedPolls">,
  reason: string
): Promise<never> {
  if ((job.data.failedPolls ?? 0) !== data.failedPolls) {
    await job.updateData({ ...job.data, ...data });
  }
  log.info("incident requeued", { jobId: job.id, incidentId: job.data.incidentId, reason });
  await job.moveToDelayed(Date.now() + REQUEUE_DELAY_MS, token);
  throw new DelayedError();
}
