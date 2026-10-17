# sync-v2 spec

Status: approved, not implemented. Work happens on the `sync-v2` branch.

## 1. Goals

1. Replace `apps/sync` (v1) with `apps/sync-v2` without regressing data quality on emergenciascr.com.
2. Record every upstream change to an incident while it is being synced, so we can see when a field went from valid to null or invalid and why.
3. Normalize SIGAE's inconsistent data in one tested place instead of patching it in the web app.
4. Prove v2 is correct by running it on `beta.emergenciascr.com` with its own database while prod keeps running v1 untouched, comparing the two sites through their public API and visually.
5. Turn real edge cases into fixture-based tests that double as documentation.
6. Move database changes from `drizzle-kit push` to committed, generated migrations applied by a dedicated migrate step.

### Non-goals

- Redesigning the web UI. Web changes are limited to section 11.
- Fixing or rebuilding v1.
- Incident renumbering. v1's `getSimilarIncident` never worked reliably and is dropped.

## 2. Decisions

| Topic                      | Decision                                                                                                                                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prod isolation             | Nothing on the `sync-v2` branch changes or depends on prod: not its database, workflows, deploys or data. Prod is only read through the public website and API. Promotion to `main` is planned separately once beta is accepted (section 14).                                                                   |
| Beta database              | Separate Postgres database (`emergenciascr_v2`) on the same server, created from scratch by migrations.                                                                                                                                                                                                         |
| Upstream values            | **Trust upstream, log it.** When SIGAE replaces a valid value with null, a placeholder, or another value, store what SIGAE says and record the change and an anomaly. No fallback to previous values, except a known location SIGAE clears, which is kept (section 6.3).                                        |
| What "trust" doesn't cover | Failed requests. Network/HTTP failures and SIGAE error envelopes are not data and are never written, with one documented exception for partial reports (section 6.1). Placeholder dates are stored as `NULL`, which is what SIGAE means.                                                                        |
| Dispatched units           | Whatever SIGAE currently reports. Units that disappear are deleted (operators often dispatch a unit by mistake and then dispatch from somewhere else). Every addition and removal is kept in the change history.                                                                                                |
| Incident gone upstream     | If a tracked incident stops existing in SIGAE, it is deleted. No search for a "similar" incident.                                                                                                                                                                                                               |
| Tracking after close       | Keep polling for 72 hours after SIGAE closes an incident. Coordinates, geography and vehicle times often arrive hours after closing.                                                                                                                                                                            |
| Long-open incidents        | Hourly polling once open for more than 72h, stop after 30 days (section 8.2). The few incidents still open by then (long wildfires, incomplete records) keep whatever SIGAE last reported.                                                                                                                      |
| Vehicle assignments        | A dispatch keeps the station SIGAE reported for it; moving a vehicle never changes past incidents. Vehicle station and operational status are recorded over time in `vehicle_station_history` (sections 5.2, 9), and station views count dispatches by the dispatch's station (section 11).                     |
| Partial reports            | A report answering `99` may set or change values but never clear them (section 6.1).                                                                                                                                                                                                                            |
| Extra report times         | Store `Hora_Controlado`, `Hora_Fuego_Bajo_Control`, `Hora_Perdidas_Detenidas` and `Hora_Todo_Claro` as columns (section 5.1). The four SIGAE never fills stay only in the raw-response history.                                                                                                                 |
| SIGAE client               | One standalone client in `packages/sigae` with native proxy support. The client owns how to talk to SIGAE (transport, timeouts, decoding); apps own what to do about the result (retries, backoff, partial and not-found handling). Section 4.1.                                                                |
| Time zones                 | Store instants: every timestamp column is `timestamptz` and the API keeps returning ISO strings in UTC. SIGAE strings are parsed as Costa Rica time. Everything shown to people is formatted in `America/Costa_Rica`, never the server's or the browser's timezone. Servers stay on UTC. Sections 3.4, 5.1, 11. |
| Observability              | OpenTelemetry only (traces, metrics, logs over OTLP); Sentry is removed. Beta gets dashboards, no alerts. Section 4.2.                                                                                                                                                                                          |
| Migrations                 | Generated SQL migrations, applied by a migrate app before every deploy (section 10).                                                                                                                                                                                                                            |
| Branch and CI              | `sync-v2` branch with its own copies of the workflows, deploying only to beta. `main` and its workflows stay untouched and deployable.                                                                                                                                                                          |

## 3. Current state

### 3.1 v2 bugs

1. **Incidents close prematurely and stop syncing.** `closeIncident` (`src/services/openIncidents.service.ts`) never reads SIGAE's `Estado_Abierto`. It closes when coordinates exist and no dispatched vehicle has `departureTime = 0001-01-01`. An incident with no stored vehicles passes, so it is closed on its first pass and never polled again. The README describes a different rule.
2. **Incidents older than 3 days are closed "regardless"**, even if SIGAE still reports them open.
3. **Station and vehicle jobs always fail.** Job IDs `station:${id}` / `vehicle:${id}` are rejected by current BullMQ ("Custom Id cannot contain :"). Missing stations/vehicles likely cause FK failures on incident upserts.
4. **Error causes are discarded.** `updateIncident` maps every DB error to `"Error updating incident N"`.
5. **Infinite requeue.** An incident that never got saved returns `not_found` and is re-queued every 3 minutes forever.
6. **SIGAE response codes are ignored** (v1 too). Error and not-found envelopes are parsed as if they were data.
7. **Reference data only syncs on the 12h cron**, not at boot.
8. **No transaction** around incident + dispatched stations + dispatched vehicles writes.
9. **No request timeouts.** A hung SIGAE request holds a worker until BullMQ marks the job stalled (15 "job stalled" errors in `logs/error.log`). See section 4.1 for the other client issues.
10. **No graceful shutdown.** Deploys kill running jobs, which come back as stalled.
11. **Telemetry mostly doesn't work.** Logs never reach OTel, and metrics and logs have no service name (section 4.2).
12. **No tests.**

### 3.2 Shared by v1 and v2 (same transform code)

1. **Placeholder dates are stored as real dates.** Vehicle time columns are `notNull` and get `0001-01-01`. The web filters this three different ways (`=== 1`, `=== 1970`, `> 1970`).
2. **Blind overwrite** of every column; no history.
3. **Removed units are never removed.**
4. **`modifiedAt` is set to `now()` on every upsert**, but the web timeline uses it as the "Incidente cerrado" time (`apps/web/api/lib/utils/incidents/timeline.ts`).
5. **Parsing depends on process `TZ`** (section 3.4).
6. **Responsible station falls back to `0`**, which is not a valid station ID.
7. **Unknown incident type codes silently become `NULL`.**
8. **`vehicleInternalNumber` is computed but has no column**, so units not present in `vehicles` lose their label.

### 3.3 Verified against SIGAE (2026-10-14)

Read-only probe of about 145 incidents (latest list plus a sample from 4–6 days earlier). Only aggregates were recorded.

**Response codes.** Every endpoint answers HTTP 200 with `Codigo` / `Descripcion`:

| `Codigo` | `Descripcion`                                                                           | Seen on                                                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00`     | `Proceso realizado satisfactoriamente`                                                  | All endpoints, normal case.                                                                                                                                                                                             |
| `03`     | `No se encontraron registros.`                                                          | All four incident endpoints for nonexistent IDs. Report and detail bodies still have every key, with `null` strings and dates and `0` IDs and coordinates; station and unit lists come back empty.                      |
| `99`     | `Ha ocurrido un error en el web service. Detalle técnico: Specified cast is not valid.` | `ObtenerBoletaIncidente` only, for 4–18% of incidents depending on the sample. Persistent: same result on every retry.                                                                                                  |
| `04`     | `Ha ocurrido un error con la base de datos…` / `Ha ocurrido un error en la aplicacion…` | Every endpoint, seen on 2026-10-15 with local development credentials: a SIGAE database permission error, and a decryption error for an outdated password. Lists come back empty. Handled like any other non-`00` code. |

**Partial reports (`99`).** The error body still contains most fields. `Fecha`, `Hora_Aviso`, `DesUbicacion` and `Estado_Abierto` matched `ObtenerDetalleEmergencias` in every case; province/canton/district IDs were missing in half. Incident 1923918 is one of them. v1 ignores `Codigo` and uses the body, which is why these incidents appear on the site. Rejecting them would drop those incidents entirely.

**Placeholder dates.** The only placeholder seen is `0001-01-01T00:00:00`. No `null`, empty strings or epoch values on any date field of a `00` or `99` response (`03` bodies use `null`). Strings never carry an offset. The web's `1970` checks protect against `new Date(null)`, not against SIGAE. `Tiempo_Desplazamiento` uses `0001-01-01T…` as a duration (always zero in the sample); it is not a placeholder and is unused.

**Incident time.** `Fecha` is the date at midnight; `Hora_Aviso` carries the same date and the real time (95 of 96; one differed). The list endpoints report the same timestamp as the report. Keep `date(Fecha) + time(Hora_Aviso)`.

**Data arrives after closing.** 48 of the latest 50 incidents were already closed upstream. Even so, coordinates were `0` for 19%, province/canton/district IDs were `0` for 27% of successful reports, and base return time was missing for 20% of units. This confirms the 72h post-close tracking.

**Units.** 10 of 118 units on closed incidents were dispatched but never arrived or left. No time-ordering violations in the sample; one dispatch earlier than the report time. Stations' `DestipoServicio` is `RESPONSABLE` or `APOYO`. Detail's per-unit `estado` was `RETIRADO` or `EN CAMINO`. In the phase 2 recordings, `NumeroInterno` was `null` on all 8 dispatched units (it is filled in `ObtenerVehiculosComboF5`); `Unidad` carries the label (`M-48`) and `UnidadCompleta` the label plus station name. Per-item `Codigo` and `Descripcion` on units and stations are `null`.

**Extra report times** (closed incidents):

| Field                                                                   | Filled                     |
| ----------------------------------------------------------------------- | -------------------------- |
| `Hora_Controlado`                                                       | ~96%, within 24h of report |
| `Hora_Fuego_Bajo_Control`, `Hora_Perdidas_Detenidas`, `Hora_Todo_Claro` | ~3% (fires)                |
| `Hora_Disponible`, `Hora_Hospital`, `Hora_Paciente`, `Hora_Traslado`    | never                      |
| Vehicle `HoraTraslado` / `HoraDevolverBase`                             | rarely                     |

**Personal data in `ObtenerBoletaIncidente`.** Caller phone (`Telefono_Avisa`) is filled 100% of the time, caller name (`Nombre_Avisa`) 91%, caller ID number (`Cedula_Avisa`) 43%. Operator username (`Usuario`), commander names (`Nombre_Mando`, `NomBomberoMando`) and free text (`Info_Relevante` 99%, `Observaciones`, `Condiciones_Especiales`) are also present.

### 3.4 Timestamp convention

- Drizzle 0.44's `timestamp()` writes `date.toISOString()` and reads values back with `+0000` appended. The database holds **UTC instants**, and reads don't depend on process `TZ`.
- SIGAE strings are Costa Rica wall-clock time. `new Date("2026-10-10T20:25:19")` is parsed in the process timezone.
- Live check: SIGAE `Hora_Aviso` for 1923918 is `2026-10-10T20:25:19`; the prod API returns `2026-10-11T02:25:19.000Z`. So v1 runs in Costa Rica time and the stored instants are correct.
- v2 parses explicitly with a `-06:00` offset (Costa Rica has no DST), so it is correct regardless of `TZ`. sync-v2 runs with the server's `TZ=UTC`; nothing in the sync may depend on process `TZ`.
- The prod web runs in UTC. Server-side code that formats dates without `timeZone: "America/Costa_Rica"` shows the UTC date: slugs (`buildIncidentSlug` uses `getDate()`), the page meta description, the OG image and the markdown pages. 1923918 was reported at 20:25 on 10 October in Costa Rica, but its slug ends in `2026-10-11` and its description says "11 de octubre". This affects incidents reported from 18:00 to midnight. Stats already use an explicit `-06:00` offset.
- Prod placeholders were created by `new Date("0001-01-01T00:00:00")` in Costa Rica time, which uses the historical local mean time offset, so they are year-1 values with an odd time. The prod API already returns them as `null` (`toIsoStringOrNull`), so comparing through the API needs no special handling.

## 4. Architecture

Keep BullMQ queues + workers and `neverthrow`, but split each incident poll into an I/O shell around a pure core.

```
fetch (4 endpoints)
  -> classify envelopes            (ok | partial | not_found | failed)
  -> redact + hash + store snapshot (only if changed)
  -> normalize(raw)                 PURE, timezone-explicit
  -> diff(current DB state, next)   PURE -> changes[]
  -> detectAnomalies(prev, next)    PURE -> anomalies[]
  -> resolve references             (on-demand fetch of missing station/vehicle/type)
  -> one transaction: upsert incident, upsert/delete children,
                      insert changes + anomalies, update sync state
  -> schedule next poll             PURE lifecycle rules -> nextPollAt | done
```

Module layout in `packages/sync-domain`, testable without Redis or a database. It depends on the SIGAE client (section 4.1) for fetching, response decoding and date parsing.

- `poll/` — `classifyPoll`: combines the four decoded responses into `ok` / `partial` / `not_found` / `failed` (section 6.1).
- `normalize/` — `normalizeIncident`, `normalizeDispatchedVehicles`, `normalizeDispatchedStations`.
- `reconcile/` — `diffIncidentState`, `detectAnomalies`.
- `lifecycle/` — `nextPoll(state, normalized, now)`.
- `redact/` — snapshot allowlists.
- `persist/` — DB writes only, no business rules.
- `pipeline/` — `syncIncident`: the I/O shell above for one incident, with the database, SIGAE client, reference resolver and clock passed in, so the worker and the web admin sync share it.

`transform/` is replaced by `normalize/`. The incident-type lookup in `rawToIncident` moves to "resolve references" so normalization stays pure.

### 4.1 SIGAE client (`packages/sigae`)

**Today.** There are two clients. `packages/sigae` (v1) reads env at import time and throws. `packages/sync-domain/src/{api,fetcher,types}.ts` is used by v2 and the web admin; it uses `neverthrow` with an injected fetcher. The two type files are identical copies. Problems with the v2 client:

- No timeout (section 3.1).
- Error causes are lost: `"Network error"`, `statusText` only, `"JSON parsing error"`.
- `Codigo` is ignored, so not-found and error responses look like data.
- Endpoints are resolved with `new URL(path, baseUrl)`, which silently drops the last path segment when the base URL has no trailing slash.
- Mixed argument styles (`getLatestIncidentsListApp(fetcher, n)` vs `({ fetcher, id })`), and callers cast results (`as unknown as ObtenerEstacionesAtiendeIncidente`).
- Date formatting is left to callers. `ObtenerListaEmergenciasApp` accepts `YYYY-MM-DD` and `MM/DD/YYYY` (range inclusive on both ends), but silently reads `DD/MM/YYYY` as month/day and returns the wrong dates.
- `sync-domain` mixes the client with DB persistence, so anything that needs the client also pulls in `@bomberoscr/db`.

**Target.** One standalone client in `packages/sigae`, with no dependency on the database, env or sync logic. It ships as new entry points (`@bomberoscr/sigae/client` and friends) next to the old v1 files, which stay untouched until promotion. The client and type copies in `sync-domain` are removed; sync-v2 and the web admin use the new client.

**Who owns what.**

| Concern                                                    | Client                                                                                                   | Apps                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Credentials, base URL, request building                    | Yes                                                                                                      | Provide config from env                  |
| Proxy                                                      | Yes                                                                                                      | Provide the proxy URL                    |
| Timeouts                                                   | Yes: default 15s, per-call override, `AbortSignal`                                                       | Choose values                            |
| Concurrency cap shared by every caller of one client       | Yes: mechanism, default 4                                                                                | Choose value                             |
| Decoding `Codigo` into typed results                       | Yes                                                                                                      | —                                        |
| Transport errors with causes                               | Yes                                                                                                      | Log and count them                       |
| Date formatting for requests, `parseSigaeDate` for replies | Yes                                                                                                      | —                                        |
| Retries and backoff                                        | No                                                                                                       | Yes: BullMQ jobs and the lifecycle (8.2) |
| Meaning of partial and not-found results                   | No                                                                                                       | Yes: `sync-domain` (6.1, 8.4)            |
| Normalization, placeholder policy, persistence             | No                                                                                                       | Yes: `sync-domain`                       |
| Telemetry                                                  | Spans and request metrics through `@opentelemetry/api` (no-op without an SDK), plus an `onResponse` hook | Yes: OTel setup, logs, dashboards (4.2)  |

No retries in the client. BullMQ already retries with backoff, and the lifecycle counts consecutive failures (8.2) and not-found polls (8.4). Retrying inside the client would multiply load on SIGAE and make those counts wrong. Callers outside the sync, like the web admin's manual sync, retry by asking again.

**API.**

```ts
const sigae = createSigaeClient({
  baseUrl,
  credentials: { user, password, systemCode, ip },
  proxy: "http://user:pass@proxy.example:8080", // optional
  timeoutMs: 15_000,
  maxConcurrency: 4,
  onResponse: (event) => {} // endpoint, durationMs, outcome, httpStatus, codigo
});

sigae.getIncidentDetails(id, { signal });
sigae.getIncidentReport(id);
sigae.getDispatchedStations(id);
sigae.getDispatchedUnits(id);
sigae.getLatestIncidents({ count: 50 });
sigae.getIncidentsBetween({ from, to }); // Date objects, sent as Costa Rica dates whatever the process TZ
sigae.ping(); // cheapest endpoint (ObtenerProvinciaLista), for boot-time checks
// …one method per endpoint in use today
```

Every method returns `ResultAsync<SigaeResponse<T>, SigaeError>`. The success channel means "SIGAE answered"; the error channel means "nothing usable came back".

- `SigaeResponse<T>` is one of:
  - `{ kind: "ok", data: T, raw }`
  - `{ kind: "not_found", raw }` (`Codigo` `03`)
  - `{ kind: "upstream_error", code, description, data: Partial<T>, raw }` (any other code; keeps the partial body, section 3.3)
- `raw` is the JSON exactly as received, for snapshots. List responses always expose `items`, whether SIGAE calls them `Items` or `items`.
- `SigaeError` kinds: `timeout`, `aborted` (the caller's `AbortSignal`), `network`, `proxy`, `http` (with status), `invalid_json`, `unexpected_shape`. Each keeps a sanitized `cause` when one is available, plus endpoint and duration. Errors and hook events never include the request body, credentials or the proxy URL.

**Types and validation.** Types describe the wire format honestly. Date fields are `SigaeDateString`: Costa Rica wall-clock time, where `0001-01-01T00:00:00` means missing. The fields the sync reads are validated at runtime with loose zod schemas (unknown keys pass through); error bodies use the same schemas made partial. A mismatch returns `unexpected_shape`, so a SIGAE format change shows up as an error instead of silently corrupt data.

**Proxy support.** Required.

- Configured per client with one HTTP(S) proxy URL, optionally with basic auth.
- Works on Bun (the runtime) through `fetch`'s native `proxy` option, and on Node (Vitest and tooling) through `undici`'s own `fetch` with a `ProxyAgent`. Mixing a separately installed undici dispatcher with Node's global `fetch` breaks across versions.
- Failures caused by the proxy (connection refused, `407`, `502` from the proxy) return `proxy` errors, distinct from SIGAE being down. Node throws a failed `CONNECT` while Bun returns the proxy's response, so with a proxy configured every `502` counts as a proxy error.
- Apps read it from `SIGAE_PROXY_URL`. sync-v2 calls `ping()` at boot, so a broken proxy fails fast with a clear error.

**Env.** Apps read `SIGAE_API_URL`, `SIGAE_USER`, `SIGAE_PASSWORD`, `SIGAE_COD_SYS`, `SIGAE_IP` and the optional `SIGAE_PROXY_URL`. sync-v2 currently calls the system code `SIGAE_SYSTEM_CODE`; it switches to `SIGAE_COD_SYS` like the web app.

### 4.2 Observability

OpenTelemetry only: traces, metrics and logs exported over OTLP. Sentry is removed. Beta gets dashboards and no alerts.

**Today.** `src/config/telemetry.ts` is set up but mostly doesn't work:

- **Logs never reach OTel in the built service.** `WinstonInstrumentation` patches winston when it is loaded. The service is bundled into one ESM file with winston external, and ESM loads every import before running the bundle's code, so winston is already loaded when `sdk.start()` runs. Monkey-patching auto-instrumentation is also unreliable on Bun.
- **Metrics and logs have no `service.name`.** They use their own `MeterProvider` and `LoggerProvider`, created outside `NodeSDK` without a resource. Only traces get the service name.
- **Two metrics in total:** job duration and incidents discovered. Nothing covers SIGAE calls, poll results, queues or lag.
- **Endpoint handling:** with no endpoint configured, it silently exports to `localhost:4318`. It also builds `/v1/*` URLs by hand instead of using the standard OTel env vars.
- **No shutdown handling.** On `SIGTERM` the process dies with telemetry still buffered and jobs still running. Those jobs come back as stalled.
- **Logs** are colorized text with values interpolated into the message, written to `logs/*.log` inside the container. Errors lose their cause (section 3.1).
- **Leftovers:** `SENTRY_DSN` is required but Sentry is never initialized. `@opentelemetry/resources` 1.x is declared next to a 2.x SDK.

**Setup.**

- One `NodeSDK` owns traces, metrics (`metricReader`) and logs (`logRecordProcessors`), started before the app code runs and flushed with `sdk.shutdown()` on exit.
- No auto-instrumentation. Everything is explicit: `bullmq-otel` for jobs, spans from the SIGAE client and the poll pipeline, and the OTel winston transport added to the logger directly.
- Configured only through standard env vars: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, and `OTEL_RESOURCE_ATTRIBUTES` (beta sets `deployment.environment.name=beta`). With no endpoint set, export is off and the service says so once at boot.
- The SIGAE client depends only on `@opentelemetry/api`. Its spans and metrics are no-ops unless the app starts the SDK, so the web admin can use the client without OTel.
- Removed: `@sentry/node`, `SENTRY_DSN`, `@opentelemetry/instrumentation-winston`, `@opentelemetry/resources` 1.x.

**Logs.**

- sync-v2 has its own logger. `packages/lib/logger` stays as it is, because v1 uses it.
- JSON lines on stdout plus the OTel transport. No log files, no colors outside development.
- Fixed fields instead of interpolated text: `incidentId`, `jobId`, `queue`, `endpoint`, `outcome`, `codigo`, `errorKind`, `durationMs`, plus trace and span IDs. Errors include the full cause chain.
- One summary line per poll: result, number of changes, anomaly codes, next poll time.
- Levels: a failed poll is `warn`; a job that fails its last attempt is `error`; anomalies are `info` (they are counted in metrics).
- Never logged: raw SIGAE bodies (the report contains personal data), credentials, the proxy URL.

**Metrics.** No incident IDs in metric attributes, to keep cardinality bounded. Those go in logs and spans. Durations are in seconds.

| Metric                          | Type      | Attributes                                     | Source                              |
| ------------------------------- | --------- | ---------------------------------------------- | ----------------------------------- |
| `sigae.client.requests`         | counter   | `endpoint`, `outcome` (result or error kind)   | SIGAE client                        |
| `sigae.client.request.duration` | histogram | `endpoint`, `outcome`                          | SIGAE client                        |
| `sync.poll.results`             | counter   | `result` (`ok`/`partial`/`not_found`/`failed`) | Poll pipeline                       |
| `sync.poll.lag`                 | histogram | —                                              | Poll start time minus `nextPollAt`  |
| `sync.incidents`                | gauge     | `phase`                                        | `incident_sync_state`, every minute |
| `sync.incidents.discovered`     | counter   | —                                              | Discovery job                       |
| `sync.discovery.delay`          | histogram | —                                              | First seen minus SIGAE report time  |
| `sync.changes`                  | counter   | `entity`, `field`, `kind`                      | Reconcile                           |
| `sync.anomalies`                | counter   | `code`                                         | Reconcile                           |
| `sync.queue.jobs`               | gauge     | `queue`, `state`                               | BullMQ job counts, every minute     |
| `sync.job.duration`             | histogram | `queue`, `outcome`                             | Workers                             |
| `sync.reference.last_success`   | gauge     | `kind` (stations, vehicles, …)                 | Reference jobs (Unix time)          |

**Traces.** One span per job (from `bullmq-otel`) → `sync.poll` (attributes: incident ID, result, change and anomaly counts) → one span per SIGAE request and one for the database transaction. Span attributes follow the same rules as logs.

**Health.** A small HTTP endpoint (`HEALTH_PORT`, on loopback unless `HEALTH_HOST` says otherwise) for the container health check. It fails when Redis or the database is unreachable. Time since the last successful SIGAE response is reported in the body but doesn't fail the check, because restarting doesn't fix SIGAE being down.

**Shutdown.** On `SIGTERM`/`SIGINT`: stop scheduling, `close()` every worker (waits for running jobs, up to 30s), close queues, Redis and the database pool, run `sdk.shutdown()`, then exit.

**Dashboard.** One dashboard for beta:

- SIGAE requests per minute by outcome, latency p50/p95 per endpoint, and proxy errors.
- Poll results over time and polling lag.
- Incidents per phase, with `failed` highlighted.
- Queue depth and failed jobs per queue.
- Anomalies by code, and changes by field.
- Discovery delay.
- Time since the last successful reference sync, per kind.

## 5. Data model changes

These changes apply to the beta database. How prod data gets this schema is decided at promotion (section 14).

### 5.1 Altered and new columns

| Table                 | Column                                                                                | Change                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dispatched_vehicles` | `dispatchedTime`, `arrivalTime`, `departureTime`, `baseReturnTime`                    | Drop `NOT NULL`. v2 writes `NULL` for placeholders.                                                                                                                                                                                                                                                                                              |
| `dispatched_vehicles` | `vehicleInternalNumber text`                                                          | New. Keeps the unit label when `vehicleId` is unknown.                                                                                                                                                                                                                                                                                           |
| All tables            | Every `timestamp` column                                                              | `timestamptz` (`withTimezone: true`). Values are the same UTC instants. Writing `now()` and `AT TIME ZONE 'America/Costa_Rica'` no longer depend on the session timezone. `date_trunc`, `DATE()` and wall-clock `EXTRACT` fields (`hour`, `dow`, ...) on a `timestamptz` still do, so SQL buckets convert to Costa Rica time first (section 11). |
| `incidents`           | `closedAt timestamptz`, `closedAtSource text` (`observed` \| `estimated`)             | New. See section 8.3.                                                                                                                                                                                                                                                                                                                            |
| `incidents`           | `controlledAt`, `fireUnderControlAt`, `lossesStoppedAt`, `allClearAt` (`timestamptz`) | New, nullable. From `Hora_Controlado`, `Hora_Fuego_Bajo_Control`, `Hora_Perdidas_Detenidas`, `Hora_Todo_Claro`. The never-filled report times are not stored as columns; they remain in snapshots.                                                                                                                                               |
| `incidents`           | `modifiedAt`                                                                          | Only bumped when normalized data actually changed.                                                                                                                                                                                                                                                                                               |
| `incidents`           | `responsibleStation`                                                                  | `NULL` instead of `0` when unknown (already nullable).                                                                                                                                                                                                                                                                                           |

### 5.2 New tables

**`sigae_snapshots`**: raw upstream responses, deduplicated.

| Column        | Type         | Notes                                              |
| ------------- | ------------ | -------------------------------------------------- |
| `id`          | bigserial PK |                                                    |
| `incidentId`  | integer      | Not an FK; history must survive incident deletion. |
| `endpoint`    | text         | One of the four incident endpoints.                |
| `codigo`      | text         | Envelope `Codigo`.                                 |
| `fetchedAt`   | timestamptz  |                                                    |
| `payloadHash` | text         | sha256 of the redacted, key-sorted payload.        |
| `payload`     | jsonb        | Redacted.                                          |

Insert only when `payloadHash` differs from the latest row for `(incidentId, endpoint)`. Index `(incidentId, endpoint, fetchedAt desc)`.

**Redaction uses explicit per-endpoint allowlists, not denylists**, because the report has many free-text and personal fields (section 3.3) and SIGAE may add more. Any key not listed, including one SIGAE adds later, is dropped. Arrays are filtered item by item, and a listed key may be kept only when another field of its item has a given value. Snapshots redact `raw` (section 4.1), so list keys are matched as SIGAE sends them: `Items[]` below also accepts `items[]`, and the key is kept as received.

- `ObtenerBoletaIncidente`: `Codigo`, `Descripcion`, `Id_Boleta_Incidente`, `Consecutivo`, `Fecha`, `Hora_Aviso`, `Hora_Controlado`, `Hora_Disponible`, `Hora_Fuego_Bajo_Control`, `Hora_Hospital`, `Hora_Paciente`, `Hora_Perdidas_Detenidas`, `Hora_Todo_Claro`, `Hora_Traslado`, `Estado_Abierto`, `DesUbicacion`, `Direccion`, `Id_Provincia`, `Id_Canton`, `Id_Distrito`, `Provincia`, `Canton`, `Distrito`, `CodigoTipoIncidenteDespacho`, `CodigoTipoIncidenteReal`, `NomtipoIncidenteDespacho`, `NomTipoIncidenteReal`, `Id_Etapa_Incidente`, `DesEtapaIncidente`, `Civiles_Heridos`, `Civiles_Fallecidos`, `Bomberos_Heridos`, `Bomberos_Fallecidos`.
- `ObtenerDetalleEmergencias`: `Codigo`, `Descripcion`, `codigo_tipo_incidente`, `codigo_tipo_incidente_despacho`, `codigo_tipo_incidente_despacho_esp`, `codigo_tipo_incidente_esp`, `consecutivo_EE`, `direccion`, `fecha`, `hora_incidente`, `latitud`, `longitud`, `tipo_incidente`, `tipo_incidente_despacho`, `tipo_incidente_despacho_esp`, `tipo_incidente_esp`, `estaciones[]` (`clave_estacion`, `nombre`, `vehiculos[]` (`estado`, `numero_interno`)). `DetallesImportantes` is free text and is not kept.
- `ObtenerEstacionesAtiendeIncidente`: `Codigo`, `Descripcion`, `Items[]` (`Codigo`, `Descripcion`, `AtencionAPie`, `ClaveEstacion`, `DestipoServicio`, `HoraAtencionAPie` only when the item's `AtencionAPie` is `true`, `IdBoletaEstacionAtiende`, `IdEstacion`, `IdTipoServicio`, `NombreEstacion`). Without attention on foot SIGAE sends its current clock time as `HoraAtencionAPie`, which carries no information and would give every poll a new hash, so it is dropped before hashing and dedupe works.
- `ObtenerUnidadesDespachadasIncidente`: `Codigo`, `Descripcion`, `Items[]` (`Codigo`, `Descripcion`, `CodigoEstacion`, `CodigoUnidad`, `DespachoAlarma`, `HoraBase`, `HoraDespacho`, `HoraDevolverBase`, `HoraLLegada`, `HoraRetiro`, `HoraTraslado`, `IdBoletaServicio`, `IdBoletaUnidadDespachada`, `IdVehiculo`, `NumeroInterno`, `Traslado`, `Unidad`, `UnidadCompleta`).

The same redaction applies to test fixtures. Fixtures are public, so recorded ones also replace incident addresses and coordinates with synthetic values.

**`incident_changes`**: field-level facts.

| Column        | Type         | Notes                                                       |
| ------------- | ------------ | ----------------------------------------------------------- |
| `id`          | bigserial PK |                                                             |
| `incidentId`  | integer      |                                                             |
| `entity`      | text         | `incident` \| `dispatched_vehicle` \| `dispatched_station`. |
| `entityId`    | integer      |                                                             |
| `field`       | text         | Normalized field name, or `*` for added/removed rows.       |
| `kind`        | text         | `set` \| `changed` \| `cleared` \| `added` \| `removed`.    |
| `oldValue`    | jsonb        |                                                             |
| `newValue`    | jsonb        |                                                             |
| `snapshotIds` | bigint[]     | Snapshots that produced this change.                        |
| `detectedAt`  | timestamptz  |                                                             |

**`sync_anomalies`**: judgments about the data (section 7). Columns: `id`, `incidentId`, `entity`, `entityId` (nullable), `code`, `details` (jsonb), `detectedAt`.

**`incident_sync_state`**: one row per tracked incident; the source of truth for scheduling, so Redis can be rebuilt from it.

| Column                | Type        | Notes                                                      |
| --------------------- | ----------- | ---------------------------------------------------------- |
| `incidentId`          | integer PK  |                                                            |
| `phase`               | text        | `active` \| `settling` \| `done` \| `deleted` \| `failed`. |
| `nextPollAt`          | timestamptz |                                                            |
| `lastPolledAt`        | timestamptz |                                                            |
| `upstreamClosedAt`    | timestamptz | First poll that saw it closed.                             |
| `consecutiveFailures` | integer     |                                                            |
| `notFoundCount`       | integer     | Consecutive not-found polls.                               |
| `emptyUnitsCount`     | integer     | Consecutive polls with zero units while the DB has some.   |
| `lastError`           | text        | Full cause.                                                |
| `firstSeenAt`         | timestamptz |                                                            |

**`vehicle_station_history`**: where each vehicle was assigned and in what operational state, over time. `vehicles` only holds the current values, which the reference sync overwrites; vehicles move between stations (maintenance, transfers to a new station), and SIGAE only reports the present.

| Column              | Type                | Notes                                                                       |
| ------------------- | ------------------- | --------------------------------------------------------------------------- |
| `id`                | bigserial PK        |                                                                             |
| `vehicleId`         | integer FK vehicles |                                                                             |
| `stationId`         | integer FK stations | `Id_estacion`.                                                              |
| `operationalStatus` | text                | `Des_estado_operativo`.                                                     |
| `firstSeenAt`       | timestamptz         | First observation of this station and status, not the real assignment date. |
| `lastSeenAt`        | timestamptz         | Last observation. Bumped while station and status stay the same.            |

Index on `(vehicleId, lastSeenAt)`. History starts when the beta database does.

## 6. Normalization rules

### 6.1 Envelopes

| Result                                                                       | Classification   | Action                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All four `00`                                                                | `ok`             | Normal write.                                                                                                                                                                                                      |
| Report `99`, the other three `00`                                            | `partial`        | Write. Fields from the partial report may **set or change** values but never **clear** them; `0`/empty in a partial report means "failed to serialize", not "SIGAE says empty". Anomaly `UPSTREAM_PARTIAL_REPORT`. |
| Detail **and** report `03`, units and stations `00` or `03`                  | `not_found`      | Not-found flow (section 8.4). No write.                                                                                                                                                                            |
| Network/HTTP error, invalid JSON, `99` on any other endpoint, any other code | `failed`         | No write. Count a failed poll.                                                                                                                                                                                     |
| Units or stations `03` while detail is `00` and report is `00` or `99`       | `ok` / `partial` | Treat as an empty list. Also with a `99` report: it is persistent, so rejecting it would keep an incident with no units or stations from ever syncing. Verify in phase 6 with a brand-new incident.                |

### 6.2 Dates

- `parseSigaeDate(raw): Date | null` from the SIGAE client (section 4.1) is the only way SIGAE dates are parsed.
- `0001-01-01T00:00:00` → `NULL`. Any other year before 1971 → `NULL` plus anomaly `PLACEHOLDER_SHAPE_UNKNOWN`.
- Strings are interpreted as Costa Rica time with an explicit `-06:00` offset. Tests run under `TZ=UTC` and `TZ=America/Costa_Rica` and must produce identical results.
- `incidentTimestamp` = date of `Fecha` + time of `Hora_Aviso`. Fixture: an incident around midnight.

### 6.3 Incident

- `Id_Distrito` / `Id_Canton` / `Id_Provincia` of `0` → `NULL`.
- Incident type codes come from the detail endpoint (as today). Strip a trailing `.`. A code not in `incident_types` triggers an incident-types sync (section 9) first. Still unknown, for each of the four codes:
  - SIGAE sent a non-empty name with that exact code in the same detail response (`tipo_incidente`, `tipo_incidente_esp`, `tipo_incidente_despacho`, `tipo_incidente_despacho_esp`) → create the type from it and store the code. A name only counts for the code it came with, so a category code sent with its name (`10` "SERVICIOS ESPECIALES" next to `10.3`) creates the parent too; levels without a name are never invented.
  - Otherwise → the nearest ancestor that exists or was just created, dropping trailing segments (`10.3.1` → `10.3` → `10`).
  - Nothing → `NULL`.
  - Each case records `UNKNOWN_INCIDENT_TYPE`, and so does a code whose type was created from incident data earlier, once per incident, field and code. Details: `field`, `incidentCode` (without the trailing `.`), `storedCode` and `resolution`: `created`, `inferred` (created earlier), `parent` or `none`.
- Created types get negative IDs (SIGAE's `id_tipo_incidente` are positive), the incident's name, and the nearest existing ancestor as `parentId`. They are created in the poll's transaction, before the incident, under a lock that serializes their creators, so concurrent polls creating the same code end with one row. A code that exists by then is left as it is.
- Coordinates: keep `"0"` for unknown (the web relies on it). `null` → `"0"`.
- **A known location is never cleared** (an exception to "trust upstream", section 2): operators clear an incident's location for minutes or hours and then set it again, so SIGAE sending a stored location as unknown keeps the stored one. A different known value still replaces it (and records `COORDINATES_MOVED` beyond 1 km).
  - Coordinates (`latitud`, `longitud`) are a pair: either one `0` or `null` while both stored are known keeps both stored values, so a half pair never replaces a full one. A stored half pair follows SIGAE.
  - Province, canton and district are a unit: all three `0` while any stored one is known keeps the stored three. When SIGAE sends some of them, what it sent is stored (missing ones become `NULL`), so a new province is never mixed with an old canton. On a `99` report the partial-report rule (section 6.1) keeps them field by field first, so this rule only finds the coordinates there.
  - A kept location records `LOCATION_CLEARED_UPSTREAM` once per incident and field group, with `fields` (`coordinates` or `geography`), `kept` (the stored values) and `received` (what SIGAE sent). Since the stored values stay, there is no `cleared` change and no `VALUE_REGRESSED` for them. An incident with nothing known yet stores what SIGAE sends, and `COORDINATES_MISSING` still applies at `done`.
  - The raw answers with the cleared location stay in `sigae_snapshots`, so what SIGAE said is not lost.
- Responsible station: `DestipoServicio === "RESPONSABLE"`, else last item, else `NULL`.
- `isOpen` = `Estado_Abierto === "true"`.
- Extra report times via `parseSigaeDate`.

### 6.4 Dispatched units and stations

- `Unidad === "ATENCION A PIE"` → `attentionOnFoot = true`, `vehicleId = NULL`.
- Times via `parseSigaeDate`. `vehicleInternalNumber` from `NumeroInterno`, which is usually `null` here (section 3.3); check the beta data before relying on it.
- Station mapping unchanged. A dispatched unit's station is the one SIGAE reports for that dispatch (`CodigoEstacion`), never the vehicle's current station, so moving a vehicle later doesn't change past incidents. A change while the incident is still polled is recorded like any other field change.
- **Removal:** a unit or station in the DB but missing from an `ok`/`partial` response is deleted, with a `removed` change and `UNIT_REMOVED` anomaly. Exception: if the response has **zero** units and the DB has some, wait for 2 consecutive polls before deleting (`emptyUnitsCount`), so a single empty response can't wipe an incident.

## 7. Anomalies

Anomalies never change what gets stored. They exist to be counted, filtered and turned into fixtures.

| Code                        | Trigger                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `VALUE_REGRESSED`           | A field was non-null and is now null/placeholder.                    |
| `VALUE_CHANGED_AFTER_SET`   | A vehicle time or coordinate changed after it was first set.         |
| `TIME_ORDER_VIOLATION`      | Not dispatched ≤ arrival ≤ departure ≤ base return (ignoring nulls). |
| `TIME_BEFORE_INCIDENT`      | A unit time earlier than `incidentTimestamp` by more than 5 minutes. |
| `TIME_IN_FUTURE`            | Later than `now` plus a small tolerance.                             |
| `PLACEHOLDER_SHAPE_UNKNOWN` | Pre-1971 date other than `0001-01-01T00:00:00`.                      |
| `UNIT_NEVER_ARRIVED`        | At `done`: unit has a dispatch time but no arrival or departure.     |
| `UNIT_REMOVED`              | Unit or station disappeared upstream.                                |
| `COORDINATES_MISSING`       | Still `0` at `done`.                                                 |
| `COORDINATES_MOVED`         | Coordinates changed by more than 1 km.                               |
| `LOCATION_CLEARED_UPSTREAM` | Known coordinates or geography sent as unknown, kept (section 6.3).  |
| `UNKNOWN_INCIDENT_TYPE`     | Code not in SIGAE's type list (section 6.3).                         |
| `MISSING_REFERENCE`         | Station or vehicle unknown even after on-demand fetch.               |
| `REOPENED`                  | Upstream went closed → open.                                         |
| `OPEN_TOO_LONG`             | Still open upstream at the hard cap (section 8.2).                   |
| `UPSTREAM_PARTIAL_REPORT`   | Report returned `99`.                                                |
| `INCIDENT_DELETED_UPSTREAM` | Not-found flow deleted the incident.                                 |

## 8. Incident lifecycle

### 8.1 Discovery

- Every minute: `ObtenerListaUltimasEmergenciasApp` (50 items). New IDs get an `incident_sync_state` row (`active`) and a job.
- Gap fill: at boot and hourly, `ObtenerListaEmergenciasApp(from, to)` for the last 6 hours.
- Bootstrap: at boot, schedule a job for every `active`/`settling` row. Losing Redis must not lose tracked incidents.

### 8.2 Polling

| Phase      | Entered when                                  | Poll interval                             | Leaves when                                                                |
| ---------- | --------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `active`   | Discovered open, or reopened                  | 3 min; hourly once open for more than 72h | Upstream closed → `settling`. Open for 30 days → `done` + `OPEN_TOO_LONG`. |
| `settling` | Upstream closed (including discovered closed) | 15 min for the first 6h, then hourly      | 72h after `upstreamClosedAt` → `done`. Reopened → `active`.                |
| `done`     | See above                                     | none                                      | —                                                                          |
| `deleted`  | Not-found flow                                | none                                      | —                                                                          |
| `failed`   | 10 consecutive failed polls                   | none                                      | Manual requeue.                                                            |

- `isOpen` always reflects upstream. v2 never closes an incident on its own.
- At most one pending job per incident.
- Failed polls retry with exponential backoff and increment `consecutiveFailures`; a successful poll resets it.

### 8.3 Closing time

- If the incident was seen open and then closed: `closedAt` = time of the first poll that saw it closed, `closedAtSource = observed` (accurate to the poll interval).
- If it was already closed when first seen (common, see 3.3) or the sync was down: `closedAt` = latest unit departure time, else `controlledAt`, else first-seen time; `closedAtSource = estimated`.
- Reopen clears `closedAt`.

### 8.4 Incident gone upstream

- A poll classified `not_found` increments `notFoundCount`. Any other result resets it.
- At 2 consecutive not-found polls at least 3 minutes apart, in one transaction: delete dispatched units and stations, delete the incident, set phase `deleted`, log `INCIDENT_DELETED_UPSTREAM`. Snapshots, changes and anomalies are kept.
- Only tracked incidents are polled, so historical incidents are never deleted because SIGAE archived them.

## 9. Reference data

- Fix job IDs: `station-${id}`, `vehicle-${id}`.
- Run every reference job once at boot, then on the 12h cron.
- Order: provinces → cantons → districts, stations → vehicles, incident types.
- Incident types: one transaction under the lock of section 6.3. A type created from incident data whose code SIGAE now lists takes SIGAE's ID and name; the row is kept (incidents reference its code), and the remaining created types are linked again to their nearest existing ancestor.
- On-demand: an incident referencing an unknown station or vehicle fetches its details first. Still unknown: station → `MISSING_REFERENCE` and failed poll (FK required); vehicle → `vehicleId = NULL`, keep `vehicleInternalNumber`, log `MISSING_REFERENCE`.
- Vehicle assignments: every time vehicle details are stored (the 12h job and on-demand fetches), the same transaction compares station and operational status with the vehicle's latest `vehicle_station_history` row. Same values: bump `lastSeenAt`. Different, or no row yet: insert a new row. Rows are never updated otherwise or deleted. A `null` status from SIGAE keeps the stored one, like the vehicle upsert. The precision is the 12h sync interval.

## 10. Migrations

Move from `drizzle-kit push` to committed migrations applied by a dedicated step.

- **Generate:** `drizzle-kit generate` writes SQL migrations into `packages/db/drizzle`, committed with the schema change. Timestamp-prefixed names (`migrations.prefix: "timestamp"` in `drizzle.config.ts`) avoid numbering conflicts between branches. `push` is only for local throwaway databases.
- **Runner:** `packages/db/src/migrate.ts` exports `migrateDatabase(connectionString)`. It opens a small `pg` pool (max 2), takes a Postgres advisory lock with a fixed key, runs drizzle's `migrate()` and closes the pool, which releases the lock. Drizzle's migrator doesn't lock, and the web and sync can deploy at the same time. It uses the same `drizzle.__drizzle_migrations` table as `drizzle-kit migrate`, so either can run against a database the other migrated.
- **Migrate app:** `apps/migrate` loads env, calls `migrateDatabase`, logs the outcome and exits non-zero on failure. Its own Dockerfile installs only the migrate app and `packages/db` in production mode.
- **CI and deploy:** a migrate job builds and pushes the migrate image first; the web and sync jobs `need` it. The server's deploy scripts run the migrate image as a one-shot container before starting the new release, and abort the deploy if it fails.
- **Baseline:** the existing `0000_fix-invalid-foreign-keys` is a one-off data fix that fails on an empty database. On the branch, replace the migration history with one generated baseline of the current schema, followed by normal migrations for the section 5 changes. The beta, local and CI databases are all created from scratch by running every migration. How prod adopts this history is decided at promotion (section 14).
- **Drizzle version:** stay on drizzle-orm 0.44 / drizzle-kit 0.31 for this rework. Drizzle 1.0 changes the relational query API used throughout the web app; upgrading is a separate project.

## 11. Web changes

Built and tested against the beta database.

1. Handle `NULL` vehicle times: `dispatchedTime` is assumed non-null in `apps/web/api/routers/incidents.ts` (`.toISOString()`) and `apps/web/api/schemas/incidents.ts` (`z.string()`).
2. Timeline closing event uses `closedAt ?? modifiedAt`.
3. One shared "missing date" helper replacing the three current placeholder checks.
4. Show `vehicleInternalNumber` when `vehicle` is null.
5. "En camino" (`isEnRoute` in `api/lib/utils/incidents/response-times.ts`) is currently true for any unit that left the scene without a base-return time. That is about 20% of units, forever. Only show it while the incident is being tracked (its `incident_sync_state` phase is `active` or `settling`, so a return time can still arrive) and the departure was less than 2 hours ago; otherwise show the return time as unknown.
6. Costa Rica time everywhere, whatever the server's or visitor's timezone (section 3.4):
   - One shared date-formatting module with `timeZone: "America/Costa_Rica"`, used by server and client code. It replaces bare `toLocaleString` / `toLocaleTimeString` / `Intl.DateTimeFormat` calls (incident article, timeline, response times, relative time, charts, OG image, markdown pages, meta descriptions). Server and client then render the same text, so hydration can't disagree.
   - Slugs use the Costa Rica date. Old slugs keep working through the existing 301 to the canonical slug.
   - Date-range filters start and end at Costa Rica midnight, not the browser's (`date-fns` `startOfDay` / `endOfDay` today).
   - SQL hour, day and month buckets convert to Costa Rica time before truncating (`date_trunc('day', col AT TIME ZONE 'America/Costa_Rica')`), never `date_trunc`, `DATE()` or a wall-clock `EXTRACT` field (`hour`, `day`, `dow`, ...) directly on a `timestamptz`, whose result follows the session timezone. Durations and `EXTRACT(epoch ...)` don't depend on the session timezone and are computed on the instants directly. This replaces the hand-written `- interval '6 hours'` in `packages/db/src/queries/stats.ts`, `stations.ts` and `map/stationsCharts.ts`, and the UTC month bucket in `sitemap.ts`. Until then, after the `timestamptz` change (section 5.1), those buckets are only right while the session timezone is UTC.
   - "Current year" checks use the Costa Rica year.
7. Station views follow the station of each dispatch, not the vehicle's current one:
   - Station vehicle list (`getStationVehiclesWithStats` in `packages/db/src/queries/stations.ts`): a vehicle's incident count and average response time only include dispatches where `dispatched_vehicles.stationId` is that station. The list itself stays "vehicles currently assigned".
   - Annual recap top vehicles (`packages/db/src/queries/stats.ts`): label each vehicle with the station it served those dispatches for (`dispatched_vehicles.stationId`), not `vehicles.stationId`.
8. Beta mode via env (`SITE_ENV=beta`): `X-Robots-Tag: noindex`, `robots.txt` disallow all, no sitemap, a visible "datos de sync-v2" banner, analytics off.

## 12. Testing

Unit tests in `packages/sync-domain` (pure, no DB/Redis); integration tests in `apps/sync-v2` against a throwaway Postgres migrated with the migrate runner.

### SIGAE client

- Unit tests with a fake `fetch` and recorded, redacted responses for every endpoint in use.
- Each `Codigo` (`00`, `03`, `99`, unknown), timeouts, network errors, non-200 responses, invalid JSON and shape changes.
- `Items` / `items` normalization, request date formatting, and the concurrency cap.
- Errors and hook events never contain credentials or the proxy URL.
- Proxy: integration test against a local proxy on both Bun and Node, including auth failure (`407`) and an unreachable proxy.
- One opt-in live smoke test (`SIGAE_LIVE=1`) that calls `ping()` through the configured proxy.

### Sync

#### Fixtures

- `fixtures/<scenario>/` with ordered snapshot files (`001.json`, …; each has the four endpoint payloads) and `expected.json` (final state, changes, anomalies).
- A capture script exports a real incident's history from `sigae_snapshots` into a fixture, already redacted.
- Every anomaly code seen during the beta run gets a fixture before it counts as handled.

#### Required cases

- `0001-01-01T00:00:00` → `NULL`; unknown pre-1971 date → `NULL` + anomaly.
- Identical results under `TZ=UTC` and `TZ=America/Costa_Rica`.
- `Fecha` + `Hora_Aviso`, including around midnight.
- Envelope classification for every row in 6.1.
- Partial report: sets fields, never clears them.
- Trailing-dot and unknown incident codes; `0` province/canton/district.
- Responsible station: RESPONSABLE, last-item fallback, empty → `NULL`.
- Coordinates `0`, filled in later, moved.
- Known coordinates or geography cleared upstream and set again: kept, `LOCATION_CLEARED_UPSTREAM` once, no `cleared` change.
- `ATENCION A PIE`.
- Unit added; unit removed; all units missing once (kept) and twice (deleted).
- Dispatched but never arrived; time-order violation; dispatch before report time.
- Valid time → placeholder: stored `NULL`, `VALUE_REGRESSED`.
- Open → closed → reopened → closed; discovered already closed; `closedAt` source.
- Not found once (kept), twice (deleted, history kept).
- Lifecycle intervals and transitions, including the 72h settling window and the 30-day cap.
- Redaction: no field outside the allowlists reaches a snapshot or fixture.
- Telemetry: a fixture poll run with in-memory OTel exporters checks span names, metric attributes (no incident IDs) and that logs contain no SIGAE bodies, credentials or proxy URL.
- Shutdown: a running job finishes and telemetry is flushed before exit.
- Web, under `TZ=UTC`: an incident reported at 20:25 Costa Rica time gets that day's date in its slug, meta description, OG image and markdown, and lands in that day's bucket in the stats.
- Comparison tool: field matching, tolerance rules and classification, using recorded API responses.

## 13. Beta run

### Branch and workflows

- Work happens on `sync-v2`. `main` keeps its own workflows untouched, so hotfixes can ship from `main` at any time.
- `.github/workflows/build-app-beta.yaml` is a copy of `build-app.yaml` that triggers on `sync-v2`. It tags images `beta`, `beta-<version>` and `beta-sha-<sha>` so it can never overwrite a prod tag. It reads `BETA_VITE_SERVER_URL` / `BETA_VITE_SITE_URL` and calls the `emergenciascr-frontend-beta` deploy hook.
- Added in phase 8 from the same template: `build-sync-v2-beta.yaml` (needs an `apps/sync-v2` Dockerfile) and `build-migrate-beta.yaml`. The web and sync beta jobs depend on the migrate job.
- Server side (manual): the beta deploy hooks, plus services for beta web, sync-v2, Redis and the migrate one-shot, all pointed at the beta database.

### Infrastructure

- Database `emergenciascr_v2` on the same Postgres server, with its own role. Nothing on the branch has credentials for the prod database.
- Redis for sync-v2.
- An OTLP endpoint for sync-v2, with `OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=beta`.
- `SIGAE_PROXY_URL` for every beta service that calls SIGAE: sync-v2, and the beta web for the admin's manual sync.
- Reference data comes from v2's own boot-time jobs. No data is copied from prod; the beta site starts empty and fills up with incidents first seen after launch.
- `beta.emergenciascr.com` runs the beta web image with `DRIZZLE_POSTGRES_URL` pointing to `emergenciascr_v2` and `SITE_ENV=beta`.
- SIGAE load roughly doubles while both syncs run.

### Comparison tool

`bun run --cwd apps/sync-v2 compare --from <date> --to <date>`. It reads the beta database and both sites' public APIs. It never touches the prod database.

- Scope: incidents in the window that are `done` in the beta database, so differences caused by the two syncs polling at different moments are excluded. The rest are listed as "in progress".
- For each incident: `GET /api/incidents/{id}` and `GET /api/incidents/{id}/response-times` from `https://emergenciascr.com` and `https://beta.emergenciascr.com`. Requests are throttled (about 2 per second) so the comparison doesn't load the prod site.
- Coverage: incidents that prod returns 404 for, and incidents in prod's list API that beta doesn't have.
- Field-level comparison of incident fields, dispatched stations and units (by ID, per time field), with coordinate-precision tolerance and fields only beta has ignored.
- Each difference is classified:
  - **expected**: a known v2 improvement (removed unit, deleted incident, missing responsible station instead of station `0`, late data v1 never picked up, "En camino" fix).
  - **explained**: the beta database's change history shows SIGAE sent this value.
  - **unexplained**: needs triage.
- Output: a markdown report with counts per field and category. Each differing incident links to its page on both sites (the API returns the `slug`). A JSON file is written for further analysis. Run daily and keep the reports.

### Duration and acceptance

At least 7 days including a weekend; 14 preferred. Beta is ready to promote when:

- Zero unexplained differences for the last 3 days.
- No incidents that prod has and beta is missing.
- No incidents stuck in `failed`, no unbounded queues.
- Every anomaly code seen has a fixture test.
- A manual side-by-side check of prod and beta looks right.

## 14. Promotion to main

Out of scope for the branch work. Planned separately once beta is accepted, using what the beta run teaches us. Decisions to make then:

- **Prod data:** migrate the prod database to the new schema and history, or start prod from the beta database. Prod has years of history; beta only has incidents since launch.
- **Schema adoption:** how the prod database, built with `push`, adopts the migration history (drift check, marking the baseline as applied), including converting columns to `timestamptz` (`USING col AT TIME ZONE 'UTC'`).
- **Slug dates:** evening incidents get a new canonical URL. Old URLs redirect, but search engines will reindex them.
- **Historical cleanup:** whether to rewrite old placeholder dates to `NULL` and backfill new columns.
- **Workflows:** fold the migrate job and sync-v2 build into the `main` workflows and delete the beta copies.
- **Alerting:** which conditions page someone (for example no SIGAE response, incidents in `failed`, queue backlog), based on what the beta dashboard shows is normal.
- **Switch and rollback:** order of stopping v1 and starting v2 against prod, and how to roll back.

## 15. Plan

The phased plan, with tasks, dependencies and completion checks, is in `PLAN.md`.

## 16. Open questions

None. All decisions are recorded in section 2.
