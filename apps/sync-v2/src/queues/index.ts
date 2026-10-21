import { incidentDiscoveryQueue } from "@/queues/incidentDiscovery.queue";
import { incidentPollQueue } from "@/queues/incidentPoll.queue";
import { referenceQueue } from "@/queues/reference.queue";
import { stationsQueue } from "@/queues/stations.queue";
import { vehiclesQueue } from "@/queues/vehicles.queue";

import type { Queue } from "bullmq";

export const allQueues: readonly Queue[] = [
  referenceQueue,
  stationsQueue,
  vehiclesQueue,
  incidentDiscoveryQueue,
  incidentPollQueue
];
