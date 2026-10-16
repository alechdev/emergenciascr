import { createQueue } from "@/lib/jobs";

// Runs every minute, so a failed run is not retried: the next one covers it.
export const incidentDiscoveryQueue = createQueue("incident-discovery", {
  removeOnComplete: 10,
  removeOnFail: 10,
  attempts: 1
});
