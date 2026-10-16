import {
  type Attributes,
  type MeterProvider,
  type Span,
  SpanKind,
  SpanStatusCode,
  type TracerProvider
} from "@opentelemetry/api";
import { ResultAsync, err, ok, type Result } from "neverthrow";

import { formatSigaeRequestDate } from "./dates";
import { type SigaeResponse, decodeBody } from "./decode";
import { SigaeError, type SigaeErrorKind, sanitizeError } from "./errors";
import { Semaphore } from "./semaphore";
import { createClientTelemetry } from "./telemetry";
import {
  type SigaeFetch,
  classifyHttpStatus,
  classifyTransportError,
  createTransport
} from "./transport";

import type { SigaeEndpoint, SigaeEndpointTypes } from "./endpoints";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_CONCURRENCY = 4;

/** Incident type IDs the public app asks for: every dispatch and real type group. */
const ALL_INCIDENT_TYPE_GROUPS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export interface SigaeCredentials {
  user: string;
  password: string;
  systemCode: string;
  ip: string;
}

export type SigaeOutcome = SigaeResponse<unknown>["kind"] | SigaeErrorKind;

/** Sent after every request. Never contains bodies, credentials or the proxy URL. */
export interface SigaeResponseEvent {
  endpoint: SigaeEndpoint;
  durationMs: number;
  outcome: SigaeOutcome;
  httpStatus?: number;
  codigo?: string;
}

export interface SigaeClientOptions {
  baseUrl: string;
  credentials: SigaeCredentials;
  /** HTTP(S) proxy URL, optionally with basic auth (`http://user:pass@host:port`). */
  proxy?: string;
  /** Per-request timeout, excluding time waiting for a concurrency slot. */
  timeoutMs?: number;
  /** Requests in flight at once, shared by every caller of this client. */
  maxConcurrency?: number;
  onResponse?: (event: SigaeResponseEvent) => void;
  /** Replaces the network layer, for tests. Cannot be combined with `proxy`. */
  fetch?: SigaeFetch;
  tracerProvider?: TracerProvider;
  meterProvider?: MeterProvider;
}

export interface SigaeCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** `ok` means SIGAE answered (see {@link SigaeResponse}); `err` means nothing usable came back. */
export type SigaeResult<E extends SigaeEndpoint> = ResultAsync<
  SigaeResponse<SigaeEndpointTypes[E]>,
  SigaeError
>;

export interface SigaeClient {
  getIncidentDetails(
    id: number,
    options?: SigaeCallOptions
  ): SigaeResult<"ObtenerDetalleEmergencias">;
  getIncidentReport(id: number, options?: SigaeCallOptions): SigaeResult<"ObtenerBoletaIncidente">;
  getDispatchedStations(
    id: number,
    options?: SigaeCallOptions
  ): SigaeResult<"ObtenerEstacionesAtiendeIncidente">;
  getDispatchedUnits(
    id: number,
    options?: SigaeCallOptions
  ): SigaeResult<"ObtenerUnidadesDespachadasIncidente">;
  getLatestIncidents(
    params: { count: number },
    options?: SigaeCallOptions
  ): SigaeResult<"ObtenerListaUltimasEmergenciasApp">;
  /**
   * Incidents reported between two Costa Rica calendar dates, both inclusive. The dates of
   * `from` and `to` are taken in Costa Rica time, whatever the process timezone.
   */
  getIncidentsBetween(
    params: { from: Date; to: Date },
    options?: SigaeCallOptions
  ): SigaeResult<"ObtenerListaEmergenciasApp">;
  getIncidentTypes(options?: SigaeCallOptions): SigaeResult<"ObtenerTiposIncidente">;
  getProvinces(options?: SigaeCallOptions): SigaeResult<"ObtenerProvinciaLista">;
  getCantons(options?: SigaeCallOptions): SigaeResult<"ObtenerCantonesLista">;
  getDistricts(options?: SigaeCallOptions): SigaeResult<"ObtenerDistritosLista">;
  getStations(options?: SigaeCallOptions): SigaeResult<"ObtenerEstaciones">;
  getOperativeStations(options?: SigaeCallOptions): SigaeResult<"ObtenerEstacionesOperativas">;
  getStationDetails(id: number, options?: SigaeCallOptions): SigaeResult<"ObtenerEstacionDetalle">;
  getVehicles(options?: SigaeCallOptions): SigaeResult<"ObtenerVehiculosComboF5">;
  getVehicleDetails(id: number, options?: SigaeCallOptions): SigaeResult<"ObtenerDatosVehiculo">;
  getVehicleAvailabilityStates(
    options?: SigaeCallOptions
  ): SigaeResult<"ObtenerEstadoDisponibilidadUnidades">;
  /** Calls the cheapest endpoint (`ObtenerProvinciaLista`), to check connectivity. */
  ping(options?: SigaeCallOptions): SigaeResult<"ObtenerProvinciaLista">;
  /** Releases proxy connections. The client must not be used afterwards. */
  close(): Promise<void>;
}

export function createSigaeClient(options: SigaeClientOptions): SigaeClient {
  const baseUrl = parseUrl(options.baseUrl, "baseUrl").href.replace(/\/+$/, "");
  const proxy = options.proxy ? parseUrl(options.proxy, "proxy") : undefined;
  if (proxy && options.fetch) {
    throw new TypeError("SIGAE client: `proxy` and `fetch` cannot be combined");
  }
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
  const semaphore = new Semaphore(
    positiveInteger(options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY, "maxConcurrency")
  );
  const transport = createTransport({ proxy, fetch: options.fetch });
  const telemetry = createClientTelemetry(options);
  const secrets = collectSecrets(options.credentials, options.proxy, proxy);
  const { credentials } = options;

  function call<E extends SigaeEndpoint>(
    endpoint: E,
    params: Record<string, unknown>,
    callOptions: SigaeCallOptions | undefined,
    spanAttributes: Attributes = {}
  ): SigaeResult<E> {
    const requestTimeoutMs = positiveInteger(callOptions?.timeoutMs ?? timeoutMs, "timeoutMs");
    return new ResultAsync(
      execute(endpoint, params, callOptions?.signal, requestTimeoutMs, spanAttributes)
    );
  }

  async function execute<E extends SigaeEndpoint>(
    endpoint: E,
    params: Record<string, unknown>,
    callerSignal: AbortSignal | undefined,
    requestTimeoutMs: number,
    spanAttributes: Attributes
  ): Promise<Result<SigaeResponse<SigaeEndpointTypes[E]>, SigaeError>> {
    let release: () => void;
    try {
      release = await semaphore.acquire(callerSignal);
    } catch {
      const error = new SigaeError({
        kind: "aborted",
        endpoint,
        durationMs: 0,
        message: "aborted while waiting for a free request slot"
      });
      finish(endpoint, undefined, error, 0);
      return err(error);
    }

    return telemetry.tracer.startActiveSpan(
      `sigae ${endpoint}`,
      {
        kind: SpanKind.CLIENT,
        attributes: { "sigae.endpoint": endpoint, "http.request.method": "POST", ...spanAttributes }
      },
      async (span) => {
        const startedAt = performance.now();
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), requestTimeoutMs);
        const signal = callerSignal
          ? AbortSignal.any([callerSignal, timeout.signal])
          : timeout.signal;
        const elapsed = () => Math.round(performance.now() - startedAt);

        const fail = (
          kind: SigaeErrorKind,
          message: string,
          extra: { httpStatus?: number; cause?: unknown; issues?: SigaeError["issues"] } = {}
        ) => {
          // A late abort wins over whatever error it caused downstream.
          if (timeout.signal.aborted) {
            kind = "timeout";
            message = `timed out after ${requestTimeoutMs}ms`;
          } else if (callerSignal?.aborted) {
            kind = "aborted";
            message = "aborted by caller";
          }
          return new SigaeError({
            kind,
            endpoint,
            durationMs: elapsed(),
            message,
            httpStatus: extra.httpStatus,
            issues: extra.issues,
            cause: sanitizeError(extra.cause, secrets)
          });
        };

        let result: Result<SigaeResponse<SigaeEndpointTypes[E]>, SigaeError>;
        let httpStatus: number | undefined;
        try {
          let response: Response;
          try {
            response = await transport.fetch(`${baseUrl}/${endpoint}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({
                IP: credentials.ip,
                Password: credentials.password,
                Usuario: credentials.user,
                codSistema: credentials.systemCode,
                ...params
              }),
              signal
            });
          } catch (cause) {
            const { kind, httpStatus: proxyStatus } = classifyTransportError(
              cause,
              transport.proxied
            );
            throw fail(kind, kind === "proxy" ? "proxy request failed" : "request failed", {
              cause,
              httpStatus: proxyStatus
            });
          }

          httpStatus = response.status;
          let text: string;
          try {
            text = await abortable(response.text(), signal);
          } catch (cause) {
            throw fail("network", "failed to read response body", { cause, httpStatus });
          }

          if (response.status < 200 || response.status >= 300) {
            const kind = classifyHttpStatus(response.status, transport.proxied);
            throw fail(kind, `HTTP ${response.status}`, { httpStatus });
          }

          let body: unknown;
          try {
            body = JSON.parse(text.replace(/^\uFEFF/, ""));
          } catch (cause) {
            throw fail("invalid_json", "response is not valid JSON", { cause, httpStatus });
          }

          const decoded = decodeBody(endpoint, body);
          if (!decoded.ok) {
            throw fail("unexpected_shape", decoded.message, { httpStatus, issues: decoded.issues });
          }
          result = ok(decoded.response);
        } catch (error) {
          result = err(
            error instanceof SigaeError
              ? error
              : fail("network", "request failed", { cause: error })
          );
        } finally {
          clearTimeout(timer);
          release();
        }

        finish(endpoint, span, result.isErr() ? result.error : result.value, elapsed(), httpStatus);
        return result;
      }
    );
  }

  function finish(
    endpoint: SigaeEndpoint,
    span: Span | undefined,
    outcome: SigaeResponse<unknown> | SigaeError,
    durationMs: number,
    httpStatus?: number
  ) {
    const isError = outcome instanceof SigaeError;
    const kind: SigaeOutcome = outcome.kind;
    const codigo = isError ? undefined : (outcome.raw.Codigo as string);
    const attributes = { endpoint, outcome: kind };
    telemetry.requests.add(1, attributes);
    telemetry.duration.record(durationMs / 1000, attributes);

    if (span) {
      span.setAttribute("sigae.outcome", kind);
      if (codigo !== undefined) span.setAttribute("sigae.codigo", codigo);
      if (httpStatus !== undefined) span.setAttribute("http.response.status_code", httpStatus);
      if (isError) {
        span.setAttribute("error.type", kind);
        span.setStatus({ code: SpanStatusCode.ERROR, message: outcome.message });
      } else if (outcome.kind === "upstream_error") {
        span.setAttribute("error.type", `codigo_${outcome.code}`);
        span.setStatus({ code: SpanStatusCode.ERROR, message: `Codigo ${outcome.code}` });
      }
      span.end();
    }

    if (options.onResponse) {
      const event: SigaeResponseEvent = { endpoint, durationMs, outcome: kind };
      if (httpStatus !== undefined) event.httpStatus = httpStatus;
      if (codigo !== undefined) event.codigo = codigo;
      try {
        options.onResponse(event);
      } catch {
        // A failing hook must not turn a SIGAE answer into an error.
      }
    }
  }

  const incidentSpan = (id: number) => ({ "sigae.incident_id": id });

  return {
    getIncidentDetails: (id, o) =>
      call("ObtenerDetalleEmergencias", { id_boleta_incidente: id }, o, incidentSpan(id)),
    getIncidentReport: (id, o) =>
      call("ObtenerBoletaIncidente", { Id_Boleta_Incidente: id }, o, incidentSpan(id)),
    getDispatchedStations: (id, o) =>
      call("ObtenerEstacionesAtiendeIncidente", { Id_Boleta_Incidente: id }, o, incidentSpan(id)),
    getDispatchedUnits: (id, o) =>
      call("ObtenerUnidadesDespachadasIncidente", { Id_Boleta_Incidente: id }, o, incidentSpan(id)),
    getLatestIncidents: ({ count }, o) =>
      call(
        "ObtenerListaUltimasEmergenciasApp",
        {
          numero_registros: count,
          id_tipo_incidentes_despacho: ALL_INCIDENT_TYPE_GROUPS,
          id_tipo_incidentes_real: ALL_INCIDENT_TYPE_GROUPS
        },
        o
      ),
    getIncidentsBetween: ({ from, to }, o) =>
      call(
        "ObtenerListaEmergenciasApp",
        { FechaDesde: formatSigaeRequestDate(from), FechaHasta: formatSigaeRequestDate(to) },
        o
      ),
    getIncidentTypes: (o) => call("ObtenerTiposIncidente", {}, o),
    getProvinces: (o) => call("ObtenerProvinciaLista", {}, o),
    getCantons: (o) => call("ObtenerCantonesLista", {}, o),
    getDistricts: (o) => call("ObtenerDistritosLista", {}, o),
    getStations: (o) => call("ObtenerEstaciones", {}, o),
    getOperativeStations: (o) => call("ObtenerEstacionesOperativas", {}, o),
    getStationDetails: (id, o) =>
      call("ObtenerEstacionDetalle", { id_estacion: id }, o, { "sigae.station_id": id }),
    getVehicles: (o) => call("ObtenerVehiculosComboF5", {}, o),
    getVehicleDetails: (id, o) =>
      call("ObtenerDatosVehiculo", { Id_Vehiculo: id }, o, { "sigae.vehicle_id": id }),
    getVehicleAvailabilityStates: (o) => call("ObtenerEstadoDisponibilidadUnidades", {}, o),
    ping: (o) => call("ObtenerProvinciaLista", {}, o),
    close: () => transport.close()
  };
}

/** Rejects as soon as the signal aborts, in case the runtime keeps reading the body. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function parseUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // The value is not echoed: the proxy URL may carry credentials.
    throw new TypeError(`SIGAE client: \`${name}\` is not a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`SIGAE client: \`${name}\` must be an http(s) URL`);
  }
  return url;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`SIGAE client: \`${name}\` must be a positive integer`);
  }
  return value;
}

/** Values that must never appear in errors, even inside messages from the runtime. */
function collectSecrets(
  credentials: SigaeCredentials,
  rawProxy: string | undefined,
  proxy: URL | undefined
): string[] {
  const secrets = new Set<string>();
  const add = (value: string | undefined) => {
    if (value) secrets.add(value);
  };
  add(rawProxy);
  if (proxy) {
    add(proxy.href);
    add(proxy.href.replace(/\/$/, ""));
    add(proxy.password);
    add(safeDecode(proxy.password));
    add(proxy.username);
    add(safeDecode(proxy.username));
    if (proxy.username || proxy.password) {
      const pair = `${safeDecode(proxy.username)}:${safeDecode(proxy.password)}`;
      add(Buffer.from(pair).toString("base64"));
    }
  }
  add(credentials.password);
  add(credentials.user);
  add(credentials.systemCode);
  add(credentials.ip);
  // Longest first, so a secret containing another is removed whole.
  return [...secrets].sort((a, b) => b.length - a.length);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
