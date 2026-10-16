import type { DispatchedStationRow } from "../types";
import type { DispatchedStation } from "@bomberoscr/sigae/client";

const RESPONSIBLE_SERVICE = "RESPONSABLE";

export function normalizeDispatchedStations(
  incidentId: number,
  stations: readonly DispatchedStation[]
): DispatchedStationRow[] {
  const rows = new Map<number, DispatchedStationRow>();
  for (const station of stations) {
    rows.set(station.IdBoletaEstacionAtiende, {
      id: station.IdBoletaEstacionAtiende,
      incidentId,
      stationId: station.IdEstacion,
      serviceTypeId: station.IdTipoServicio,
      attentionOnFoot: station.AtencionAPie
    });
  }
  return [...rows.values()];
}

/** The `RESPONSABLE` station, else the last one listed, else `null` (never `0`). */
export function responsibleStation(stations: readonly DispatchedStation[]): number | null {
  const responsible = stations.find((station) => station.DestipoServicio === RESPONSIBLE_SERVICE);
  return (responsible ?? stations.at(-1))?.IdEstacion || null;
}
