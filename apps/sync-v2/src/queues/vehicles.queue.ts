import { createQueue } from "@/lib/jobs";

import type { VehicleJobData } from "@/services/vehicles.service";

export const vehiclesQueue = createQueue<VehicleJobData>("vehicles", {
  removeOnComplete: true,
  removeOnFail: 50,
  attempts: 3,
  backoff: { type: "exponential", delay: 30 * 1000 }
});

export const vehicleJobId = (id: number) => `vehicle-${id}`;
