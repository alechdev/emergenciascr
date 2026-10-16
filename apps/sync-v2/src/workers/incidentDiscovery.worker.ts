import { createWorker } from "@/lib/jobs";
import logger from "@/lib/logger";
import { incidentsDiscovered } from "@/lib/metrics";
import { incidentDiscoveryQueue } from "@/queues/incidentDiscovery.queue";
import { openIncidentJobId, openIncidentsQueue } from "@/queues/openIncidents.queue";
import { getNewIncidents } from "@/services/incidentDiscovery.service";

const log = logger.child({ queue: incidentDiscoveryQueue.name });

export function createIncidentDiscoveryWorker() {
  return createWorker<Record<string, never>, { discovered: number }>(
    incidentDiscoveryQueue.name,
    async (job) => {
      const newIncidents = await getNewIncidents();
      if (newIncidents.isErr()) throw newIncidents.error;

      const ids = newIncidents.value;
      if (ids.length > 0) {
        await openIncidentsQueue.addBulk(
          ids.map((incidentId) => ({
            name: "open-incident",
            data: { incidentId },
            opts: { jobId: openIncidentJobId(incidentId), delay: 0 }
          }))
        );
      }

      incidentsDiscovered.add(ids.length);
      log[ids.length > 0 ? "info" : "debug"]("discovery finished", {
        jobId: job.id,
        discovered: ids.length
      });
      return { discovered: ids.length };
    },
    { concurrency: 1 }
  );
}
