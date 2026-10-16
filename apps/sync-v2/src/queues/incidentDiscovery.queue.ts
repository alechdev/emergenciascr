import { createQueue } from "@/lib/jobs";

/** Every minute: the latest incidents. */
export const DISCOVERY_JOB_NAME = "incident-discovery";
/** At boot and hourly: resume every tracked incident, then the last 6 hours of incidents. */
export const GAP_FILL_JOB_NAME = "incident-gap-fill";

// Both run on a schedule, so a failed run is not retried: the next one covers it.
export const incidentDiscoveryQueue = createQueue("incident-discovery", {
  removeOnComplete: 10,
  removeOnFail: 10,
  attempts: 1
});
