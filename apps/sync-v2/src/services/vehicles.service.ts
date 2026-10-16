import { db } from "@bomberoscr/db/index";
import { upsertVehicleDetails } from "@bomberoscr/sync-domain/persist";
import { ResultAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";
import { expectOk } from "@/lib/sigae";

export interface VehicleJobData {
  id: number;
}

export function listVehicles(): ResultAsync<VehicleJobData[], SyncError> {
  return expectOk(sigae.getVehicles(), "vehicles list").map((list) =>
    list.items.map((vehicle) => ({ id: vehicle.IdVehiculo }))
  );
}

export function syncSingleVehicle(id: number): ResultAsync<void, SyncError> {
  return expectOk(sigae.getVehicleDetails(id), `vehicle ${id} details`).andThen((details) =>
    ResultAsync.fromPromise(
      upsertVehicleDetails(db, id, details),
      (cause) => new SyncError(`failed to store vehicle ${id}`, { cause })
    )
  );
}
