import { createQueue } from "@/lib/jobs";

import type { StationJobData } from "@/services/stations.service";

export const stationsQueue = createQueue<StationJobData>("stations", {
  removeOnComplete: true,
  removeOnFail: 50,
  attempts: 3,
  backoff: { type: "exponential", delay: 30 * 1000 }
});

export const stationJobId = (id: number) => `station-${id}`;
