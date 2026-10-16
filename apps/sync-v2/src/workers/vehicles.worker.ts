import { createWorker } from "@/lib/jobs";
import logger from "@/lib/logger";
import { VEHICLE_JOB_NAME, vehiclesQueue } from "@/queues/vehicles.queue";
import { type VehicleJobData, syncSingleVehicle } from "@/services/vehicles.service";

export function createVehiclesWorker() {
  return createWorker<VehicleJobData, void>(
    vehiclesQueue.name,
    async (job) => {
      if (job.name !== VEHICLE_JOB_NAME) {
        // e.g. `vehicles:seed` from the previous sync; the reference worker seeds vehicles now.
        logger.info("dropped legacy job", {
          queue: vehiclesQueue.name,
          jobId: job.id,
          jobName: job.name
        });
        return;
      }
      const result = await syncSingleVehicle(job.data.id);
      if (result.isErr()) throw result.error;
    },
    { concurrency: 4 }
  );
}
