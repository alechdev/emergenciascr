/** Synthetic SIGAE bodies and states for tests. Only allowlisted fields, no real data. */
import { decodeBody } from "@bomberoscr/sigae/client";
import { err, ok } from "neverthrow";

import { normalizePoll } from "../src/normalize/index";
import { classifyPoll } from "../src/poll/classify";

import type {
  EndpointFailure,
  EndpointResult,
  IncidentPollResponses,
  PollClassification
} from "../src/poll/classify";
import type { IncidentState, SigaeIncidentEndpoint, SyncState } from "../src/types";

export const PLACEHOLDER = "0001-01-01T00:00:00";
export const INCIDENT_ID = 1900001;
export const OK = { Codigo: "00", Descripcion: "Proceso realizado satisfactoriamente" };
export const NOT_FOUND = { Codigo: "03", Descripcion: "No se encontraron registros." };
export const CAST_ERROR = {
  Codigo: "99",
  Descripcion:
    "Ha ocurrido un error en el web service. Detalle técnico: Specified cast is not valid."
};
export const KNOWN_INCIDENT_TYPES: ReadonlySet<string> = new Set([
  "2.1",
  "2.1.3",
  "2.1.3.1",
  "6.1",
  "6.1.2"
]);

type Body = Record<string, unknown>;

export function reportBody(overrides: Body = {}): Body {
  return {
    ...OK,
    Id_Boleta_Incidente: INCIDENT_ID,
    Consecutivo: "51234-2026",
    Fecha: "2026-10-10T00:00:00",
    Hora_Aviso: "2026-10-10T20:25:19",
    Hora_Controlado: PLACEHOLDER,
    Hora_Disponible: PLACEHOLDER,
    Hora_Fuego_Bajo_Control: PLACEHOLDER,
    Hora_Hospital: PLACEHOLDER,
    Hora_Paciente: PLACEHOLDER,
    Hora_Perdidas_Detenidas: PLACEHOLDER,
    Hora_Todo_Claro: PLACEHOLDER,
    Hora_Traslado: PLACEHOLDER,
    Estado_Abierto: "true",
    DesUbicacion: "SAN JOSE SAN JOSE CARMEN CALLE SINTETICA 1",
    Direccion: "EDIFICIO SINTETICO",
    Id_Provincia: 1,
    Id_Canton: 101,
    Id_Distrito: 10101,
    Provincia: "SAN JOSE",
    Canton: "SAN JOSE",
    Distrito: "CARMEN",
    CodigoTipoIncidenteDespacho: "2.1.",
    CodigoTipoIncidenteReal: "2.1.3.1",
    NomtipoIncidenteDespacho: "INCENDIO",
    NomTipoIncidenteReal: "VIVIENDA",
    Id_Etapa_Incidente: 1,
    DesEtapaIncidente: "EN ATENCION",
    Civiles_Heridos: 0,
    Civiles_Fallecidos: 0,
    Bomberos_Heridos: 0,
    Bomberos_Fallecidos: 0,
    ...overrides
  };
}

export function detailsBody(overrides: Body = {}): Body {
  return {
    ...OK,
    codigo_tipo_incidente: "2.1.3.",
    codigo_tipo_incidente_despacho: "2.1.",
    codigo_tipo_incidente_despacho_esp: "2.1.3.",
    codigo_tipo_incidente_esp: "2.1.3.1",
    consecutivo_EE: "51234-2026",
    direccion: "SAN JOSE SAN JOSE CARMEN CALLE SINTETICA 1",
    fecha: "2026-10-10T00:00:00",
    hora_incidente: "2026-10-10T20:25:19",
    latitud: 9.9,
    longitud: -84.1,
    tipo_incidente: "INCENDIO DE ESTRUCTURA",
    tipo_incidente_despacho: "INCENDIO",
    tipo_incidente_despacho_esp: "INCENDIO DE ESTRUCTURA",
    tipo_incidente_esp: "VIVIENDA",
    estaciones: [],
    ...overrides
  };
}

export function station(overrides: Body = {}): Body {
  return {
    Codigo: null,
    Descripcion: null,
    AtencionAPie: false,
    ClaveEstacion: "1-1",
    DestipoServicio: "RESPONSABLE",
    HoraAtencionAPie: PLACEHOLDER,
    IdBoletaEstacionAtiende: 3400101,
    IdEstacion: 2,
    IdTipoServicio: 1,
    NombreEstacion: "METROPOLITANA NORTE",
    ...overrides
  };
}

export function unit(overrides: Body = {}): Body {
  return {
    Codigo: null,
    Descripcion: null,
    CodigoEstacion: 2,
    CodigoUnidad: 140,
    DespachoAlarma: false,
    HoraBase: PLACEHOLDER,
    HoraDespacho: "2026-10-10T20:26:02",
    HoraDevolverBase: PLACEHOLDER,
    HoraLLegada: PLACEHOLDER,
    HoraRetiro: PLACEHOLDER,
    HoraTraslado: PLACEHOLDER,
    IdBoletaServicio: 0,
    IdBoletaUnidadDespachada: 5200101,
    IdVehiculo: 140,
    NumeroInterno: null,
    Traslado: false,
    Unidad: "M-12",
    UnidadCompleta: "M-12 METROPOLITANA NORTE",
    ...overrides
  };
}

export function listBody(items: Body[], envelope: Body = OK): Body {
  return { ...envelope, Items: items };
}

/** An endpoint's answer: a body as SIGAE would send it, or a request failure. */
export type EndpointInput = { body: unknown } | { error: EndpointFailure };

export interface PollInput {
  details?: EndpointInput;
  report?: EndpointInput;
  stations?: EndpointInput;
  units?: EndpointInput;
}

export function decode<E extends SigaeIncidentEndpoint>(
  endpoint: E,
  input: EndpointInput
): EndpointResult<E> {
  if ("error" in input) return err(input.error);
  const decoded = decodeBody(endpoint, input.body);
  if (!decoded.ok) return err({ kind: "unexpected_shape", message: decoded.message });
  return ok(decoded.response) as EndpointResult<E>;
}

/** Decodes bodies through the SIGAE client's decoder, as a real poll would. */
export function pollResponses(input: PollInput = {}): IncidentPollResponses {
  return {
    details: decode("ObtenerDetalleEmergencias", input.details ?? { body: detailsBody() }),
    report: decode("ObtenerBoletaIncidente", input.report ?? { body: reportBody() }),
    stations: decode(
      "ObtenerEstacionesAtiendeIncidente",
      input.stations ?? { body: listBody([station()]) }
    ),
    units: decode(
      "ObtenerUnidadesDespachadasIncidente",
      input.units ?? { body: listBody([unit()]) }
    )
  };
}

export function classify(input: PollInput = {}): PollClassification {
  return classifyPoll(pollResponses(input));
}

/** The state a poll with these bodies would store, before lifecycle rules. */
export function incidentState(input: PollInput = {}): IncidentState {
  const classification = classify(input);
  if (classification.kind !== "ok" && classification.kind !== "partial") {
    throw new Error(`expected ok or partial, got ${classification.kind}`);
  }
  const normalized = normalizePoll(INCIDENT_ID, classification.data);
  return {
    incident: { ...normalized.incident, closedAt: null, closedAtSource: null },
    vehicles: normalized.vehicles,
    stations: normalized.stations
  };
}

export function syncState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    incidentId: INCIDENT_ID,
    phase: "active",
    nextPollAt: null,
    lastPolledAt: null,
    upstreamClosedAt: null,
    consecutiveFailures: 0,
    notFoundCount: 0,
    emptyUnitsCount: 0,
    lastError: null,
    firstSeenAt: new Date("2026-10-11T02:26:00.000Z"),
    ...overrides
  };
}

/** Costa Rica wall-clock time to an instant, written out so tests don't depend on `TZ`. */
export function cr(wallClock: string): Date {
  return new Date(`${wallClock}-06:00`);
}
