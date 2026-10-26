import { formatCostaRicaDate } from "@bomberoscr/lib/costa-rica-time";

type DescribedIncident = {
  incidentTimestamp: string;
  address: string | null;
  EEConsecutive: string;
};

type DescribedStation = {
  vehicles: readonly unknown[];
};

/** The incident page's meta, Open Graph and JSON-LD description. */
export function buildIncidentDescription(
  incident: DescribedIncident,
  stations: readonly DescribedStation[]
): string {
  const date = formatCostaRicaDate(incident.incidentTimestamp, "longDate");
  const address = incident.address ? ` en ${incident.address}` : "";
  const vehicleCount = stations.reduce((acc, station) => acc + station.vehicles.length, 0);
  return `Incidente reportado el ${date}${address}. EE-${incident.EEConsecutive}. ${stations.length} estación(es) y ${vehicleCount} unidad(es) despachadas.`;
}
