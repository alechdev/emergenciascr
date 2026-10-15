import { createWorker } from "@/lib/jobs";
import { stationsQueue } from "@/queues/stations.queue";
import { type StationJobData, syncSingleStation } from "@/services/stations.service";

export function createStationsWorker() {
  return createWorker<StationJobData, void>(
    stationsQueue.name,
    async (job) => {
      const result = await syncSingleStation(job.data);
      if (result.isErr()) throw result.error;
    },
    { concurrency: 4 }
  );
}
