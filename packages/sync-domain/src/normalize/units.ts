import { normalizeDate, type PlaceholderIssue } from "./dates";

import type { DispatchedVehicleRow } from "../types";
import type { DispatchedUnit } from "@bomberoscr/sigae/client";

/** The `Unidad` SIGAE reports for a station attending on foot, without a vehicle. */
export const ON_FOOT_UNIT = "ATENCION A PIE";

/** Spec section 6.4. */
export function normalizeDispatchedVehicles(
  incidentId: number,
  units: readonly DispatchedUnit[],
  issues: PlaceholderIssue[]
): DispatchedVehicleRow[] {
  const rows = new Map<number, DispatchedVehicleRow>();
  for (const unit of units) {
    const id = unit.IdBoletaUnidadDespachada;
    const source = { entity: "dispatched_vehicle", entityId: id, issues } as const;
    const onFoot = unit.Unidad === ON_FOOT_UNIT;
    rows.set(id, {
      id,
      incidentId,
      stationId: unit.CodigoEstacion,
      vehicleId: onFoot ? null : unit.CodigoUnidad,
      vehicleInternalNumber: unit.NumeroInterno || null,
      dispatchedTime: normalizeDate(unit.HoraDespacho, "dispatchedTime", "HoraDespacho", source),
      arrivalTime: normalizeDate(unit.HoraLLegada, "arrivalTime", "HoraLLegada", source),
      departureTime: normalizeDate(unit.HoraRetiro, "departureTime", "HoraRetiro", source),
      baseReturnTime: normalizeDate(unit.HoraBase, "baseReturnTime", "HoraBase", source),
      attentionOnFoot: onFoot
    });
  }
  return [...rows.values()];
}
