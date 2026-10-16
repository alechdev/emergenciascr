import { db } from "@bomberoscr/db/index";
import { upsertVehicleDetails } from "@bomberoscr/sync-domain/persist";
import { ResultAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";
import { expectOk } from "@/lib/sigae";

import type { Database } from "@bomberoscr/db/client";
import type { SigaeClient } from "@bomberoscr/sigae/client";

export interface VehicleJobData {
  id: number;
}

export interface VehicleSyncDeps {
  db: Database;
  sigae: Pick<SigaeClient, "getVehicleDetails">;
  now: () => Date;
}

const defaultDeps: VehicleSyncDeps = { db, sigae, now: () => new Date() };

export function listVehicles(): ResultAsync<VehicleJobData[], SyncError> {
  return expectOk(sigae.getVehicles(), "vehicles list").map((list) =>
    list.items.map((vehicle) => ({ id: vehicle.IdVehiculo }))
  );
}

/** Stores one vehicle's details and its `vehicle_station_history` row, in one transaction. */
export function syncSingleVehicle(
  id: number,
  deps: VehicleSyncDeps = defaultDeps
): ResultAsync<void, SyncError> {
  return expectOk(deps.sigae.getVehicleDetails(id), `vehicle ${id} details`).andThen((details) =>
    ResultAsync.fromPromise(
      upsertVehicleDetails(deps.db, id, details, deps.now()),
      (cause) => new SyncError(`failed to store vehicle ${id}`, { cause })
    )
  );
}
