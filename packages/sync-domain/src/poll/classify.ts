import { incidentTimestamp } from "../normalize/dates";

import type { SigaeIncidentEndpoint } from "../types";
import type {
  DispatchedStation,
  DispatchedUnit,
  IncidentDetails,
  IncidentReport,
  SigaeEndpointTypes,
  SigaeResponse
} from "@bomberoscr/sigae/client";
import type { Result } from "neverthrow";

/** Why a request produced no SIGAE answer (a `SigaeError` fits). */
export interface EndpointFailure {
  kind: string;
  message: string;
}

export type EndpointResult<E extends SigaeIncidentEndpoint> = Result<
  SigaeResponse<SigaeEndpointTypes[E]>,
  EndpointFailure
>;

/** The four incident endpoints for one poll. */
export interface IncidentPollResponses {
  details: EndpointResult<"ObtenerDetalleEmergencias">;
  report: EndpointResult<"ObtenerBoletaIncidente">;
  stations: EndpointResult<"ObtenerEstacionesAtiendeIncidente">;
  units: EndpointResult<"ObtenerUnidadesDespachadasIncidente">;
}

/** Report fields an incident cannot be stored without. */
export const REQUIRED_REPORT_FIELDS = [
  "Fecha",
  "Hora_Aviso",
  "Consecutivo",
  "DesUbicacion",
  "Direccion",
  "Estado_Abierto"
] as const;

/** A report with at least the required fields. A partial (`99`) report may lack the rest. */
export type PollReport = Partial<IncidentReport> &
  Pick<IncidentReport, (typeof REQUIRED_REPORT_FIELDS)[number]>;

export interface IncidentPollData {
  details: IncidentDetails;
  report: PollReport;
  stations: DispatchedStation[];
  units: DispatchedUnit[];
}

export type PollClassification =
  | { kind: "ok"; data: IncidentPollData }
  /** The report answered `99`: its values may set or change fields but never clear them. */
  | { kind: "partial"; data: IncidentPollData; reportDescription: string }
  | { kind: "not_found" }
  | { kind: "failed"; endpoint: SigaeIncidentEndpoint; reason: string };

export type PollKind = PollClassification["kind"];

const PARTIAL_REPORT_CODE = "99";

/**
 * Combines the four incident responses into one outcome (spec section 6.1):
 *
 * - all four `00`: `ok`;
 * - report `99` and the rest `00`: `partial`;
 * - detail **and** report `03`: `not_found`;
 * - units or stations `03`: an empty list;
 * - anything else (request failures, other codes, `99` elsewhere, a report without the
 *   fields an incident needs): `failed`.
 *
 * Request failures win over everything else, so a flaky endpoint can never make an incident
 * look deleted.
 */
export function classifyPoll(responses: IncidentPollResponses): PollClassification {
  if (responses.details.isErr()) {
    return requestFailed("ObtenerDetalleEmergencias", responses.details.error);
  }
  if (responses.report.isErr()) {
    return requestFailed("ObtenerBoletaIncidente", responses.report.error);
  }
  if (responses.stations.isErr()) {
    return requestFailed("ObtenerEstacionesAtiendeIncidente", responses.stations.error);
  }
  if (responses.units.isErr()) {
    return requestFailed("ObtenerUnidadesDespachadasIncidente", responses.units.error);
  }
  const details = responses.details.value;
  const report = responses.report.value;
  const stations = responses.stations.value;
  const units = responses.units.value;

  if (details.kind === "not_found" && report.kind === "not_found") return { kind: "not_found" };

  if (details.kind !== "ok") return failed("ObtenerDetalleEmergencias", describe(details));

  let partialDescription: string | undefined;
  let pollReport: PollReport;
  if (report.kind === "ok") {
    pollReport = report.data;
  } else if (report.kind === "upstream_error" && report.code === PARTIAL_REPORT_CODE) {
    const missing = REQUIRED_REPORT_FIELDS.filter(
      (field) => typeof report.data[field] !== "string"
    );
    if (missing.length > 0) {
      return failed("ObtenerBoletaIncidente", `${describe(report)} without ${missing.join(", ")}`);
    }
    pollReport = report.data as PollReport;
    partialDescription = report.description;
  } else {
    return failed("ObtenerBoletaIncidente", describe(report));
  }

  const timestamp = incidentTimestamp(pollReport.Fecha, pollReport.Hora_Aviso, {
    entity: "incident",
    entityId: 0,
    issues: []
  });
  if (timestamp === null) {
    return failed("ObtenerBoletaIncidente", "report has no incident time (Fecha, Hora_Aviso)");
  }

  const stationItems = listItems(stations);
  if (stationItems === null) {
    return failed("ObtenerEstacionesAtiendeIncidente", describe(stations));
  }
  const unitItems = listItems(units);
  if (unitItems === null) {
    return failed("ObtenerUnidadesDespachadasIncidente", describe(units));
  }

  const data: IncidentPollData = {
    details: details.data,
    report: pollReport,
    stations: stationItems,
    units: unitItems
  };
  return partialDescription === undefined
    ? { kind: "ok", data }
    : { kind: "partial", data, reportDescription: partialDescription };
}

function listItems<T>(response: SigaeResponse<{ items: T[] }>): T[] | null {
  if (response.kind === "ok") return response.data.items;
  if (response.kind === "not_found") return [];
  return null;
}

function describe(response: SigaeResponse<unknown>): string {
  return response.kind === "upstream_error"
    ? `answered Codigo ${response.code} (${response.description})`
    : "answered Codigo 03 (no records)";
}

function requestFailed(
  endpoint: SigaeIncidentEndpoint,
  failure: EndpointFailure
): PollClassification {
  return failed(endpoint, `request failed (${failure.kind}): ${failure.message}`);
}

function failed(endpoint: SigaeIncidentEndpoint, reason: string): PollClassification {
  return { kind: "failed", endpoint, reason };
}
