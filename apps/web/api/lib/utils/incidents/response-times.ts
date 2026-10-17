import {
  calculateTimeDiffInSeconds,
  getDispatchedVehicleLabel,
  toIsoStringOrNull
} from "@api/lib/utils/incidents/formatters";
import { isKnownDate } from "@bomberoscr/lib/missing-date";

import type { IncidentSyncPhase } from "@bomberoscr/db/schema";

type IncidentResponseTimeVehicle = {
  id: number;
  vehicle: string;
  station: string;
  dispatchedTime: string | null;
  arrivalTime: string | null;
  departureTime: string | null;
  baseReturnTime: string | null;
  responseTimeSeconds: number;
  onSceneTimeSeconds: number;
  returnTimeSeconds: number;
  totalTimeSeconds: number;
  isEnRoute: boolean;
};

/** A unit that left the scene this long ago without a base return time has an unknown one. */
const EN_ROUTE_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Whether sync-v2 still polls the incident, so a base return time can still arrive. `null` for
 * incidents it never tracked.
 */
function isIncidentTracked(syncState: { phase: IncidentSyncPhase } | null | undefined): boolean {
  return syncState?.phase === "active" || syncState?.phase === "settling";
}

/**
 * "En camino" (returning to base) only while a return time can still arrive: the incident is
 * tracked and the unit left the scene less than 2 hours ago. Many units never get a base
 * return time, and showing them en route forever is wrong.
 */
function isVehicleEnRoute(
  vehicle: { departureTime: Date | null; baseReturnTime: Date | null },
  isTracked: boolean,
  now: Date
): boolean {
  if (!isTracked || !isKnownDate(vehicle.departureTime) || isKnownDate(vehicle.baseReturnTime)) {
    return false;
  }
  return now.getTime() - vehicle.departureTime.getTime() < EN_ROUTE_WINDOW_MS;
}

function buildIncidentResponseTimes(
  incident: {
    isOpen: boolean;
    syncState: { phase: IncidentSyncPhase } | null;
    dispatchedVehicles: Array<{
      id: number;
      dispatchedTime: Date | null;
      arrivalTime: Date | null;
      departureTime: Date | null;
      baseReturnTime: Date | null;
      vehicle: { internalNumber: string } | null;
      vehicleInternalNumber: string | null;
      station: { name: string } | null;
    }>;
  },
  { now = new Date() }: { now?: Date } = {}
): IncidentResponseTimeVehicle[] {
  const isTracked = isIncidentTracked(incident.syncState);
  return incident.dispatchedVehicles.map((vehicle) => {
    const responseTimeSeconds = calculateTimeDiffInSeconds(
      vehicle.arrivalTime,
      vehicle.dispatchedTime
    );
    const hasDeparture = isKnownDate(vehicle.departureTime);
    const hasReturn = isKnownDate(vehicle.baseReturnTime);
    const onSceneEndDate = hasDeparture ? vehicle.departureTime : incident.isOpen ? now : null;
    const onSceneTimeSeconds = calculateTimeDiffInSeconds(onSceneEndDate, vehicle.arrivalTime);
    const isEnRoute = isVehicleEnRoute(vehicle, isTracked, now);
    const returnTimeSeconds =
      hasDeparture && hasReturn
        ? calculateTimeDiffInSeconds(vehicle.baseReturnTime, vehicle.departureTime)
        : 0;
    const totalTimeSeconds = responseTimeSeconds + onSceneTimeSeconds + returnTimeSeconds;

    return {
      id: vehicle.id,
      vehicle: getDispatchedVehicleLabel(vehicle),
      station: vehicle.station?.name ?? "Estación desconocida",
      dispatchedTime: toIsoStringOrNull(vehicle.dispatchedTime),
      arrivalTime: toIsoStringOrNull(vehicle.arrivalTime),
      departureTime: toIsoStringOrNull(vehicle.departureTime),
      baseReturnTime: toIsoStringOrNull(vehicle.baseReturnTime),
      responseTimeSeconds,
      onSceneTimeSeconds,
      returnTimeSeconds,
      totalTimeSeconds,
      isEnRoute
    };
  });
}

export { buildIncidentResponseTimes, isIncidentTracked, isVehicleEnRoute };
export type { IncidentResponseTimeVehicle };
