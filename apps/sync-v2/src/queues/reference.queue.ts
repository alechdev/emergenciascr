import { createQueue } from "@/lib/jobs";

export interface ReferenceJobData {
  /** Kinds already synced by an earlier attempt of the same job. */
  completedKinds?: string[];
}

export const referenceQueue = createQueue<ReferenceJobData>("reference", {
  removeOnComplete: 10,
  removeOnFail: 10,
  attempts: 3,
  backoff: { type: "exponential", delay: 5 * 60 * 1000 }
});
