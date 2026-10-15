import { db } from "@bomberoscr/db/index";
import { vehicles as vehiclesTable } from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";
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
  return expectOk(sigae.getVehicleDetails(id), `vehicle ${id} details`).andThen((details) => {
    const row = {
      id,
      internalNumber: details.Numero_interno,
      plate: details.Placa ?? "",
      class: details.Des_clase_vehiculo ?? "",
      descriptionType: details.Des_tipo_vehiculo ?? "",
      stationId: details.Id_estacion,
      descriptionOperationalStatus: details.Des_estado_operativo ?? ""
    };

    return ResultAsync.fromPromise(
      db
        .insert(vehiclesTable)
        .values(row)
        .onConflictDoUpdate({
          target: vehiclesTable.id,
          set: conflictUpdateSetAllColumns(vehiclesTable)
        }),
      (cause) => new SyncError(`failed to store vehicle ${id}`, { cause })
    ).map(() => undefined);
  });
}
