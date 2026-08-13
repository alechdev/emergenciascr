import {
  calculateTimeDiffInSeconds,
  isUndefinedDate,
  toIsoStringOrNull
} from "@api/lib/utils/incidents/formatters";

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

function buildIncidentResponseTimes(incident: {
  isOpen: boolean;
  dispatchedVehicles: Array<{
    id: number;
    dispatchedTime: Date | null;
    arrivalTime: Date | null;
    departureTime: Date | null;
    baseReturnTime: Date | null;
    vehicle: { internalNumber: string } | null;
    station: { name: string } | null;
  }>;
}): IncidentResponseTimeVehicle[] {
  return incident.dispatchedVehicles.map((vehicle) => {
    const responseTimeSeconds = calculateTimeDiffInSeconds(
      vehicle.arrivalTime,
      vehicle.dispatchedTime
    );
    const hasDeparture = !!vehicle.departureTime && !isUndefinedDate(vehicle.departureTime);
    const hasReturn = !!vehicle.baseReturnTime && !isUndefinedDate(vehicle.baseReturnTime);
    const onSceneEndDate = hasDeparture
      ? vehicle.departureTime
      : incident.isOpen
        ? new Date()
        : null;
    const onSceneTimeSeconds = calculateTimeDiffInSeconds(onSceneEndDate, vehicle.arrivalTime);
    const isEnRoute = hasDeparture && !hasReturn;
    const returnTimeSeconds =
      hasDeparture && hasReturn
        ? calculateTimeDiffInSeconds(vehicle.baseReturnTime, vehicle.departureTime)
        : 0;
    const totalTimeSeconds = responseTimeSeconds + onSceneTimeSeconds + returnTimeSeconds;

    return {
      id: vehicle.id,
      vehicle: vehicle.vehicle?.internalNumber || "N/A",
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

export { buildIncidentResponseTimes };
export type { IncidentResponseTimeVehicle };
