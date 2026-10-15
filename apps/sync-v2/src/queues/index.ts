import { incidentDiscoveryQueue } from "@/queues/incidentDiscovery.queue";
import { openIncidentsQueue } from "@/queues/openIncidents.queue";
import { referenceQueue } from "@/queues/reference.queue";
import { stationsQueue } from "@/queues/stations.queue";
import { vehiclesQueue } from "@/queues/vehicles.queue";

import type { Queue } from "bullmq";

export const allQueues: readonly Queue[] = [
  referenceQueue,
  stationsQueue,
  vehiclesQueue,
  incidentDiscoveryQueue,
  openIncidentsQueue
];
