import { toIsoStringOrNull } from "@api/lib/utils/incidents/formatters";

type DispatchedVehicleSummary = {
  internalNumber: string;
  dispatchTime: string | null;
  arrivalTime: string | null;
  departureTime: string | null;
};

type StationSummary = {
  id: number;
  key?: string;
  name: string;
  isResponsible: boolean;
  vehicles: DispatchedVehicleSummary[];
};

function resolveResponsibleStationId(incident: {
  responsibleStation: number | null;
  dispatchedStations: Array<{ serviceTypeId: number | null; station: { id: number } }>;
}): number | null {
  const fromDispatch = incident.dispatchedStations.find((station) => station.serviceTypeId === 1)
    ?.station.id;
  if (fromDispatch) {
    return fromDispatch;
  }
  return incident.responsibleStation ?? null;
}

function buildDispatchedStationsSummary(incident: {
  responsibleStation: number | null;
  dispatchedStations: Array<{
    serviceTypeId: number | null;
    station: { id: number; name: string; stationKey: string };
  }>;
  dispatchedVehicles: Array<{
    stationId: number | null;
    dispatchedTime: Date | null;
    arrivalTime: Date | null;
    departureTime: Date | null;
    vehicle: { internalNumber: string } | null;
    station: { id: number; name: string } | null;
  }>;
}): StationSummary[] {
  const responsibleStationId = resolveResponsibleStationId(incident);
  const stationMap = new Map<number, StationSummary>();

  for (const dispatched of incident.dispatchedStations) {
    const stationId = dispatched.station.id;
    const isResponsible = dispatched.serviceTypeId === 1;
    const existing = stationMap.get(stationId);
    if (existing) {
      if (isResponsible) {
        existing.isResponsible = true;
      }
      continue;
    }
    stationMap.set(stationId, {
      id: stationId,
      key: dispatched.station.stationKey,
      name: dispatched.station.name,
      isResponsible,
      vehicles: []
    });
  }

  for (const vehicle of incident.dispatchedVehicles) {
    const stationId = vehicle.stationId ?? vehicle.station?.id;
    if (!stationId) continue;
    const existing = stationMap.get(stationId);
    if (!existing) {
      stationMap.set(stationId, {
        id: stationId,
        name: vehicle.station?.name ?? "Estación desconocida",
        isResponsible: false,
        vehicles: []
      });
    }

    stationMap.get(stationId)?.vehicles.push({
      internalNumber: vehicle.vehicle?.internalNumber ?? "N/A",
      dispatchTime: toIsoStringOrNull(vehicle.dispatchedTime),
      arrivalTime: toIsoStringOrNull(vehicle.arrivalTime),
      departureTime: toIsoStringOrNull(vehicle.departureTime)
    });
  }

  if (
    !Array.from(stationMap.values()).some((station) => station.isResponsible) &&
    responsibleStationId
  ) {
    const fallback = stationMap.get(responsibleStationId);
    if (fallback) {
      fallback.isResponsible = true;
    }
  }

  return Array.from(stationMap.values());
}

export { buildDispatchedStationsSummary, resolveResponsibleStationId };
export type { StationSummary };
