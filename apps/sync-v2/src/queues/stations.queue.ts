import { createQueue } from "@/lib/jobs";

import type { StationJobData } from "@/services/stations.service";

export const stationsQueue = createQueue<StationJobData>("stations", {
  removeOnComplete: true,
  removeOnFail: 50,
  attempts: 3,
  backoff: { type: "exponential", delay: 30 * 1000 }
});

/** The only job name this queue processes; jobs left by older versions are dropped. */
export const STATION_JOB_NAME = "station";
export const stationJobId = (id: number) => `station-${id}`;
