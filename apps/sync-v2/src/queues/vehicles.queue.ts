import { createQueue } from "@/lib/jobs";

import type { VehicleJobData } from "@/services/vehicles.service";

export const vehiclesQueue = createQueue<VehicleJobData>("vehicles", {
  removeOnComplete: true,
  removeOnFail: 50,
  attempts: 3,
  backoff: { type: "exponential", delay: 30 * 1000 }
});

/** The only job name this queue processes; jobs left by older versions are dropped. */
export const VEHICLE_JOB_NAME = "vehicle";
export const vehicleJobId = (id: number) => `vehicle-${id}`;
