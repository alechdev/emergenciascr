import { createWorker } from "@/lib/jobs";
import logger from "@/lib/logger";
import {
  DISCOVERY_JOB_NAME,
  GAP_FILL_JOB_NAME,
  incidentDiscoveryQueue
} from "@/queues/incidentDiscovery.queue";
import {
  type DiscoveryDeps,
  discoverLatestIncidents,
  fillDiscoveryGap,
  resumePolledIncidents
} from "@/services/incidentDiscovery.service";

const log = logger.child({ queue: incidentDiscoveryQueue.name });

/**
 * `incident-discovery` (every minute) tracks new incidents among the latest ones, and
 * schedules listed ones that are still polled but lost their poll job.
 * `incident-gap-fill` (at boot and hourly) first schedules every tracked incident again,
 * which rebuilds the poll queue after Redis lost it, then tracks what the last 6 hours
 * have that discovery missed.
 */
export function createIncidentDiscoveryWorker(deps: DiscoveryDeps) {
  return createWorker<Record<string, never>, Record<string, number>>(
    incidentDiscoveryQueue.name,
    async (job): Promise<Record<string, number>> => {
      if (job.name === GAP_FILL_JOB_NAME) {
        const resumed = await resumePolledIncidents(deps);
        log.info("tracked incidents resumed", { jobId: job.id, ...resumed });
        const gap = await fillDiscoveryGap(deps);
        log[gap.discovered.length > 0 ? "info" : "debug"]("gap fill finished", {
          jobId: job.id,
          listed: gap.listed,
          discovered: gap.discovered.length,
          incidentIds: gap.discovered,
          rescheduled: gap.rescheduled
        });
        return { ...resumed, discovered: gap.discovered.length };
      }
      if (job.name !== DISCOVERY_JOB_NAME) {
        log.info("dropped unknown job", { jobId: job.id, jobName: job.name });
        return {};
      }
      const latest = await discoverLatestIncidents(deps);
      log[latest.discovered.length > 0 || latest.rescheduled > 0 ? "info" : "debug"](
        "discovery finished",
        {
          jobId: job.id,
          discovered: latest.discovered.length,
          incidentIds: latest.discovered,
          rescheduled: latest.rescheduled
        }
      );
      return { discovered: latest.discovered.length, rescheduled: latest.rescheduled };
    },
    { concurrency: 1 }
  );
}
