import { createWorker } from "@/lib/jobs";
import logger from "@/lib/logger";
import { STATION_JOB_NAME, stationsQueue } from "@/queues/stations.queue";
import { type StationJobData, syncSingleStation } from "@/services/stations.service";

export function createStationsWorker() {
  return createWorker<StationJobData, void>(
    stationsQueue.name,
    async (job) => {
      if (job.name !== STATION_JOB_NAME) {
        // e.g. `stations:seed` from the previous sync; the reference worker seeds stations now.
        logger.info("dropped legacy job", {
          queue: stationsQueue.name,
          jobId: job.id,
          jobName: job.name
        });
        return;
      }
      const result = await syncSingleStation(job.data);
      if (result.isErr()) throw result.error;
    },
    { concurrency: 4 }
  );
}
