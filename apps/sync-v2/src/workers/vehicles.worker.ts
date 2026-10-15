import { createWorker } from "@/lib/jobs";
import { vehiclesQueue } from "@/queues/vehicles.queue";
import { type VehicleJobData, syncSingleVehicle } from "@/services/vehicles.service";

export function createVehiclesWorker() {
  return createWorker<VehicleJobData, void>(
    vehiclesQueue.name,
    async (job) => {
      const result = await syncSingleVehicle(job.data.id);
      if (result.isErr()) throw result.error;
    },
    { concurrency: 4 }
  );
}
