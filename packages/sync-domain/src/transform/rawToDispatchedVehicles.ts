import type { dispatchedVehiclesInsertSchema } from "@bomberoscr/db/schema";
import type { DispatchedUnit } from "@bomberoscr/sigae/client";
import type { z } from "zod";

export function rawToDispatchedVehicles({
  incidentId,
  dispatchedVehicles
}: {
  incidentId: number;
  dispatchedVehicles: DispatchedUnit[];
}): z.infer<typeof dispatchedVehiclesInsertSchema>[] {
  return dispatchedVehicles.map((vehicle) => ({
    id: vehicle.IdBoletaUnidadDespachada,
    arrivalTime: new Date(vehicle.HoraLLegada),
    baseReturnTime: new Date(vehicle.HoraBase),
    departureTime: new Date(vehicle.HoraRetiro),
    dispatchedTime: new Date(vehicle.HoraDespacho),
    incidentId: incidentId,
    stationId: vehicle.CodigoEstacion,
    vehicleId: vehicle.Unidad === "ATENCION A PIE" ? null : vehicle.CodigoUnidad,
    vehicleInternalNumber: vehicle.NumeroInterno,
    attentionOnFoot: vehicle.Unidad === "ATENCION A PIE"
  }));
}
