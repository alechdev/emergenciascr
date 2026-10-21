import { incidentTimestamp, normalizeDate, type PlaceholderIssue } from "./dates";
import { responsibleStation } from "./stations";

import type { IncidentPollData } from "../poll/classify";
import type { IncidentRow } from "../types";

/** An incident as SIGAE describes it. `closedAt` comes from the lifecycle rules. */
export type NormalizedIncident = Omit<IncidentRow, "closedAt" | "closedAtSource">;

/** Incident fields read from `ObtenerBoletaIncidente`, the ones a partial report can't clear. */
export const REPORT_FIELDS = [
  "EEConsecutive",
  "address",
  "importantDetails",
  "incidentTimestamp",
  "provinceId",
  "cantonId",
  "districtId",
  "controlledAt",
  "fireUnderControlAt",
  "lossesStoppedAt",
  "allClearAt"
] as const satisfies readonly (keyof NormalizedIncident)[];

/** Spec section 6.3. Pure: incident type codes are checked against the database later. */
export function normalizeIncident(
  incidentId: number,
  { details, report, stations }: IncidentPollData,
  issues: PlaceholderIssue[]
): NormalizedIncident {
  const source = { entity: "incident", entityId: incidentId, issues } as const;
  const timestamp = incidentTimestamp(report.Fecha, report.Hora_Aviso, source);
  if (timestamp === null) {
    throw new Error(`Incident ${incidentId}: report has no incident time`);
  }

  return {
    id: incidentId,
    EEConsecutive: report.Consecutivo,
    address: report.DesUbicacion,
    importantDetails: report.Direccion,
    incidentTimestamp: timestamp,
    provinceId: geographyId(report.Id_Provincia),
    cantonId: geographyId(report.Id_Canton),
    districtId: geographyId(report.Id_Distrito),
    incidentCode: normalizeIncidentTypeCode(details.codigo_tipo_incidente),
    specificIncidentCode: normalizeIncidentTypeCode(details.codigo_tipo_incidente_esp),
    dispatchIncidentCode: normalizeIncidentTypeCode(details.codigo_tipo_incidente_despacho),
    specificDispatchIncidentCode: normalizeIncidentTypeCode(
      details.codigo_tipo_incidente_despacho_esp
    ),
    responsibleStation: responsibleStation(stations),
    latitude: coordinate(details.latitud),
    longitude: coordinate(details.longitud),
    coordinatesClearedUpstream: false,
    isOpen: report.Estado_Abierto === "true",
    controlledAt: normalizeDate(report.Hora_Controlado, "controlledAt", "Hora_Controlado", source),
    fireUnderControlAt: normalizeDate(
      report.Hora_Fuego_Bajo_Control,
      "fireUnderControlAt",
      "Hora_Fuego_Bajo_Control",
      source
    ),
    lossesStoppedAt: normalizeDate(
      report.Hora_Perdidas_Detenidas,
      "lossesStoppedAt",
      "Hora_Perdidas_Detenidas",
      source
    ),
    allClearAt: normalizeDate(report.Hora_Todo_Claro, "allClearAt", "Hora_Todo_Claro", source)
  };
}

/** SIGAE codes sometimes end in `.` (`6.1.2.`); `incident_types` has them without it. */
export function normalizeIncidentTypeCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const stripped = code.endsWith(".") ? code.slice(0, -1) : code;
  return stripped === "" ? null : stripped;
}

/** `0` means unknown. */
function geographyId(id: number | undefined): number | null {
  return id === undefined || id === 0 ? null : id;
}

/** The web treats `"0"` as "no coordinates". */
function coordinate(value: number | null | undefined): string {
  return value === null || value === undefined || value === 0 ? "0" : String(value);
}

/**
 * Applies the partial-report rule (section 6.1): values from a `99` report may set or change
 * fields but never clear them, because an empty value there means SIGAE failed to serialize it.
 */
export function keepReportValues(
  previous: NormalizedIncident | null,
  next: NormalizedIncident
): NormalizedIncident {
  if (previous === null) return next;
  const merged: NormalizedIncident = { ...next };
  for (const field of REPORT_FIELDS) {
    if (isEmpty(next[field]) && !isEmpty(previous[field])) {
      (merged as Record<string, unknown>)[field] = previous[field];
    }
  }
  return merged;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}
