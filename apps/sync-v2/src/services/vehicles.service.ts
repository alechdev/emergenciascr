import { db } from "@bomberoscr/db/index";
import { vehicles as vehiclesTable } from "@bomberoscr/db/schema";
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
    // A `null` from SIGAE keeps the stored value; `""` only fills the column for a new vehicle.
    const nullable = {
      plate: details.Placa,
      class: details.Des_clase_vehiculo,
      descriptionType: details.Des_tipo_vehiculo,
      descriptionOperationalStatus: details.Des_estado_operativo
    };
    const known = Object.fromEntries(
      Object.entries(nullable).filter(([, value]) => value !== null)
    ) as Partial<Record<keyof typeof nullable, string>>;
    const update = {
      internalNumber: details.Numero_interno,
      stationId: details.Id_estacion,
      ...known
    };
    const row = {
      id,
      plate: "",
      class: "",
      descriptionType: "",
      descriptionOperationalStatus: "",
      ...update
    };

    return ResultAsync.fromPromise(
      db.insert(vehiclesTable).values(row).onConflictDoUpdate({
        target: vehiclesTable.id,
        set: update
      }),
      (cause) => new SyncError(`failed to store vehicle ${id}`, { cause })
    ).map(() => undefined);
  });
}
