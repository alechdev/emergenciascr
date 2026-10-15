import { createQueue } from "@/lib/jobs";

export interface IncidentSyncJobData {
  incidentId: number;
  /** Consecutive polls that could not update the incident. */
  failedPolls?: number;
}

export const openIncidentsQueue = createQueue<IncidentSyncJobData>("open-incidents", {
  removeOnComplete: 10,
  removeOnFail: 50,
  delay: 3 * 60 * 1000,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 }
});

export const openIncidentJobId = (incidentId: number) => `open-incident-${incidentId}`;
