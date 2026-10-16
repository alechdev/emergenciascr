import { type Result, ResultAsync, err, ok } from "neverthrow";

import type {
  IncidentReport,
  SigaeCallOptions,
  SigaeClient,
  SigaeEndpoint,
  SigaeResponse
} from "@bomberoscr/sigae/client";
import type { UpsertIncidentInput } from "@bomberoscr/sync-domain/persist/upsertIncident";

export type FetchIncidentErrorKind = "not_found" | "failed";

export class FetchIncidentError extends Error {
  override readonly name = "FetchIncidentError";
  readonly kind: FetchIncidentErrorKind;
  readonly incidentId: number;

  constructor(
    kind: FetchIncidentErrorKind,
    incidentId: number,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(`Incident ${incidentId}: ${message}`, options);
    this.kind = kind;
    this.incidentId = incidentId;
  }
}

/** Report fields the upsert cannot do without. */
const REQUIRED_REPORT_FIELDS = [
  "Fecha",
  "Hora_Aviso",
  "Consecutivo",
  "DesUbicacion",
  "Direccion",
  "Estado_Abierto"
] as const;

const PARTIAL_REPORT_CODE = "99";

/**
 * Fetches the four incident endpoints and returns what `upsertIncident` needs.
 *
 * - Detail **and** report `03`: `not_found`. Only one of them `03`: `failed`.
 * - A report answering `99` is used when it still has the fields the upsert needs, as v1
 *   does (SIGAE answers `99` for some incidents on every retry, with most of the body).
 * - Units or stations `03`: empty lists.
 * - Anything else that is not `00`, and every transport error: `failed`, with the cause.
 */
export function fetchIncident(
  sigae: SigaeClient,
  incidentId: number,
  options?: SigaeCallOptions
): ResultAsync<UpsertIncidentInput, FetchIncidentError> {
  return ResultAsync.combine([
    sigae.getIncidentDetails(incidentId, options),
    sigae.getIncidentReport(incidentId, options),
    sigae.getDispatchedStations(incidentId, options),
    sigae.getDispatchedUnits(incidentId, options)
  ] as const)
    .mapErr((cause) => new FetchIncidentError("failed", incidentId, cause.message, { cause }))
    .andThen(([details, report, stations, units]) => {
      if (details.kind === "not_found" && report.kind === "not_found") {
        return err(new FetchIncidentError("not_found", incidentId, "not found in SIGAE"));
      }
      const incidentDetails = okData(incidentId, "ObtenerDetalleEmergencias", details);
      if (incidentDetails.isErr()) return err(incidentDetails.error);
      const incidentReport = usableReport(incidentId, report);
      if (incidentReport.isErr()) return err(incidentReport.error);
      const stationsAttending = listItems(
        incidentId,
        "ObtenerEstacionesAtiendeIncidente",
        stations
      );
      if (stationsAttending.isErr()) return err(stationsAttending.error);
      const vehiclesDispatched = listItems(
        incidentId,
        "ObtenerUnidadesDespachadasIncidente",
        units
      );
      if (vehiclesDispatched.isErr()) return err(vehiclesDispatched.error);

      return ok<UpsertIncidentInput>({
        incidentId,
        incidentDetails: incidentDetails.value,
        incidentReport: incidentReport.value,
        stationsAttending: stationsAttending.value,
        vehiclesDispatched: vehiclesDispatched.value
      });
    });
}

function okData<T>(
  incidentId: number,
  endpoint: SigaeEndpoint,
  response: SigaeResponse<T>
): Result<T, FetchIncidentError> {
  if (response.kind === "ok") return ok(response.data);
  return err(upstreamError(incidentId, endpoint, response));
}

function usableReport(
  incidentId: number,
  response: SigaeResponse<IncidentReport>
): Result<IncidentReport, FetchIncidentError> {
  if (response.kind === "ok") return ok(response.data);
  if (response.kind === "upstream_error" && response.code === PARTIAL_REPORT_CODE) {
    const data = response.data;
    if (REQUIRED_REPORT_FIELDS.every((field) => typeof data[field] === "string")) {
      return ok(data as IncidentReport);
    }
  }
  return err(upstreamError(incidentId, "ObtenerBoletaIncidente", response));
}

function listItems<T>(
  incidentId: number,
  endpoint: SigaeEndpoint,
  response: SigaeResponse<{ items: T[] }>
): Result<T[], FetchIncidentError> {
  if (response.kind === "ok") return ok(response.data.items);
  if (response.kind === "not_found") return ok([]);
  return err(upstreamError(incidentId, endpoint, response));
}

function upstreamError(
  incidentId: number,
  endpoint: SigaeEndpoint,
  response: SigaeResponse<unknown>
): FetchIncidentError {
  const detail =
    response.kind === "upstream_error"
      ? `Codigo ${response.code} (${response.description})`
      : "no records (Codigo 03)";
  return new FetchIncidentError("failed", incidentId, `${endpoint} answered ${detail}`);
}
