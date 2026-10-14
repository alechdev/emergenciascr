# sync-v2 spec

Status: draft, not implemented. Work happens on the `sync-v2` branch.

## 1. Goals

1. Replace `apps/sync` (v1) with `apps/sync-v2` without regressing data quality on emergenciascr.com.
2. Record every upstream change to an incident while it is being synced, so we can see when a field went from valid to null or invalid and why.
3. Normalize SIGAE's inconsistent data in one tested place instead of patching it in the web app.
4. Prove v2 is correct by running it next to v1 against a separate database, comparing results with a diff tool and visually on `beta.emergenciascr.com`.
5. Turn real edge cases into fixture-based tests that double as documentation.
6. Move database changes from `drizzle-kit push` to committed, generated migrations applied by a dedicated migrate step.

### Non-goals

- News outlets / AI summaries (`src/services/news`). Not wired into `src/index.ts`; out of scope.
- Redesigning the web UI. Web changes are limited to section 11.
- Fixing or rebuilding v1.
- Incident renumbering. v1's `getSimilarIncident` never worked reliably and is dropped.

## 2. Decisions

| Topic                      | Decision                                                                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shadow database            | Separate Postgres database on the same server as prod.                                                                                                                                                                                   |
| Upstream values            | **Trust upstream, log it.** When SIGAE replaces a valid value with null, a placeholder, or another value, store what SIGAE says and record the change and an anomaly. No fallback to previous values.                                    |
| What "trust" doesn't cover | Failed requests. Network/HTTP failures and SIGAE error envelopes are not data and are never written, with one documented exception for partial reports (section 6.1). Placeholder dates are stored as `NULL`, which is what SIGAE means. |
| Dispatched units           | Whatever SIGAE currently reports. Units that disappear are deleted (operators often dispatch a unit by mistake and then dispatch from somewhere else). Every addition and removal is kept in the change history.                         |
| Incident gone upstream     | If a tracked incident stops existing in SIGAE, it is deleted. No search for a "similar" incident.                                                                                                                                        |
| Tracking after close       | Keep polling for 72 hours after SIGAE closes an incident. Coordinates, geography and vehicle times often arrive hours after closing.                                                                                                     |
| Migrations                 | Generated SQL migrations, applied by a migrate app before every deploy (section 10).                                                                                                                                                     |
| Branch and CI              | `sync-v2` branch with its own copies of the workflows, deploying to beta. `main` stays deployable independently.                                                                                                                         |

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
9. **No tests.**

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

| `Codigo` | `Descripcion`                                                                           | Seen on                                                                                                                |
| -------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `00`     | `Proceso realizado satisfactoriamente`                                                  | All endpoints, normal case.                                                                                            |
| `03`     | `No se encontraron registros.`                                                          | All four incident endpoints for nonexistent IDs. The body still has every key, filled with default values.             |
| `99`     | `Ha ocurrido un error en el web service. Detalle técnico: Specified cast is not valid.` | `ObtenerBoletaIncidente` only, for 4–18% of incidents depending on the sample. Persistent: same result on every retry. |

**Partial reports (`99`).** The error body still contains most fields. `Fecha`, `Hora_Aviso`, `DesUbicacion` and `Estado_Abierto` matched `ObtenerDetalleEmergencias` in every case; province/canton/district IDs were missing in half. Incident 1923918 is one of them. v1 ignores `Codigo` and uses the body, which is why these incidents appear on the site. Rejecting them would drop those incidents entirely.

**Placeholder dates.** The only placeholder seen is `0001-01-01T00:00:00`. No `null`, empty strings or epoch values on any date field. Strings never carry an offset. The web's `1970` checks protect against `new Date(null)`, not against SIGAE. `Tiempo_Desplazamiento` uses `0001-01-01T…` as a duration (always zero in the sample); it is not a placeholder and is unused.

**Incident time.** `Fecha` is the date at midnight; `Hora_Aviso` carries the same date and the real time (95 of 96; one differed). The list endpoints report the same timestamp as the report. Keep `date(Fecha) + time(Hora_Aviso)`.

**Data arrives after closing.** 48 of the latest 50 incidents were already closed upstream. Even so, coordinates were `0` for 19%, province/canton/district IDs were `0` for 27% of successful reports, and base return time was missing for 20% of units. This confirms the 72h post-close tracking.

**Units.** 10 of 118 units on closed incidents were dispatched but never arrived or left. No time-ordering violations in the sample; one dispatch earlier than the report time. Stations' `DestipoServicio` is `RESPONSABLE` or `APOYO`. Detail's per-unit `estado` was `RETIRADO` or `EN CAMINO`.

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
- v2 parses explicitly with a `-06:00` offset (Costa Rica has no DST), so it is correct regardless of `TZ`.
- Prod placeholders were created by `new Date("0001-01-01T00:00:00")` in Costa Rica time, which uses the historical local mean time offset. They are year-1 values with an odd time. Anything with year ≤ 1 counts as a placeholder when reading prod data.

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

Module layout in `packages/sync-domain`, testable without Redis or a database:

- `envelope/` — `classifyResponse`.
- `normalize/` — `normalizeIncident`, `normalizeDispatchedVehicles`, `normalizeDispatchedStations`, `parseSigaeDate`.
- `reconcile/` — `diffIncidentState`, `detectAnomalies`.
- `lifecycle/` — `nextPoll(state, normalized, now)`.
- `redact/` — snapshot allowlists.
- `persist/` — DB writes only, no business rules.

`transform/` is replaced by `normalize/`. The incident-type lookup in `rawToIncident` moves to "resolve references" so normalization stays pure.

## 5. Data model changes

All changes are additive or loosen constraints, so they are safe to apply to the prod database while v1 is still running. Applying them to both databases lets the same web build serve prod and beta.

### 5.1 Altered and new columns

| Table                 | Column                                                                              | Change                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispatched_vehicles` | `dispatchedTime`, `arrivalTime`, `departureTime`, `baseReturnTime`                  | Drop `NOT NULL`. v2 writes `NULL` for placeholders.                                                                                                                                                |
| `dispatched_vehicles` | `vehicleInternalNumber text`                                                        | New. Keeps the unit label when `vehicleId` is unknown.                                                                                                                                             |
| `incidents`           | `closedAt timestamp`, `closedAtSource text` (`observed` \| `estimated`)             | New. See section 8.3.                                                                                                                                                                              |
| `incidents`           | `controlledAt`, `fireUnderControlAt`, `lossesStoppedAt`, `allClearAt` (`timestamp`) | New, nullable. From `Hora_Controlado`, `Hora_Fuego_Bajo_Control`, `Hora_Perdidas_Detenidas`, `Hora_Todo_Claro`. The never-filled report times are not stored as columns; they remain in snapshots. |
| `incidents`           | `modifiedAt`                                                                        | Only bumped when normalized data actually changed.                                                                                                                                                 |
| `incidents`           | `responsibleStation`                                                                | `NULL` instead of `0` when unknown (already nullable).                                                                                                                                             |

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

**Redaction uses allowlists, not denylists**, because the report has many free-text fields (section 3.3):

- `ObtenerBoletaIncidente`: keep only `Codigo`, `Descripcion`, `Id_Boleta_Incidente`, `Consecutivo`, `Fecha`, every `Hora_*`, `Estado_Abierto`, `DesUbicacion`, `Direccion`, `Id_Provincia`, `Id_Canton`, `Id_Distrito`, `Provincia`, `Canton`, `Distrito`, `CodigoTipoIncidenteDespacho`, `CodigoTipoIncidenteReal`, `NomtipoIncidenteDespacho`, `NomTipoIncidenteReal`, `Id_Etapa_Incidente`, `DesEtapaIncidente`, casualty counts (`Civiles_*`, `Bomberos_*`).
- `ObtenerDetalleEmergencias`: everything except `DetallesImportantes`.
- Stations and units: everything.

The same redaction applies to test fixtures.

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

## 6. Normalization rules

### 6.1 Envelopes

| Result                                                                       | Classification | Action                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All four `00`                                                                | `ok`           | Normal write.                                                                                                                                                                                                      |
| Report `99`, the other three `00`                                            | `partial`      | Write. Fields from the partial report may **set or change** values but never **clear** them; `0`/empty in a partial report means "failed to serialize", not "SIGAE says empty". Anomaly `UPSTREAM_PARTIAL_REPORT`. |
| Detail **and** report `03`                                                   | `not_found`    | Not-found flow (section 8.4). No write.                                                                                                                                                                            |
| Network/HTTP error, invalid JSON, `99` on any other endpoint, any other code | `failed`       | No write. Count a failed poll.                                                                                                                                                                                     |
| Units or stations `03` while detail and report are `00`                      | `ok`           | Treat as an empty list. Verify in M0 with a brand-new incident.                                                                                                                                                    |

### 6.2 Dates

- `parseSigaeDate(raw): Date | null` is the only way SIGAE dates are parsed.
- `0001-01-01T00:00:00` → `NULL`. Any other year before 1971 → `NULL` plus anomaly `PLACEHOLDER_SHAPE_UNKNOWN`.
- Strings are interpreted as Costa Rica time with an explicit `-06:00` offset. Tests run under `TZ=UTC` and `TZ=America/Costa_Rica` and must produce identical results.
- `incidentTimestamp` = date of `Fecha` + time of `Hora_Aviso`. Fixture: an incident around midnight.

### 6.3 Incident

- `Id_Distrito` / `Id_Canton` / `Id_Provincia` of `0` → `NULL`.
- Incident type codes come from the detail endpoint (as today). Strip a trailing `.`. Unknown code → `NULL` + anomaly `UNKNOWN_INCIDENT_TYPE` + trigger an incident-types sync.
- Coordinates: keep `"0"` for unknown (the web relies on it). `null` → `"0"`.
- Responsible station: `DestipoServicio === "RESPONSABLE"`, else last item, else `NULL`.
- `isOpen` = `Estado_Abierto === "true"`.
- Extra report times via `parseSigaeDate`.

### 6.4 Dispatched units and stations

- `Unidad === "ATENCION A PIE"` → `attentionOnFoot = true`, `vehicleId = NULL`.
- Times via `parseSigaeDate`. `vehicleInternalNumber` from `NumeroInterno`.
- Station mapping unchanged.
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
| `UNKNOWN_INCIDENT_TYPE`     | Code not in `incident_types`.                                        |
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
- At 2 consecutive not-found polls at least 3 minutes apart, in one transaction: delete dispatched units and stations, set `news_articles.incidentId` to `NULL`, delete the incident, set phase `deleted`, log `INCIDENT_DELETED_UPSTREAM`. Snapshots, changes and anomalies are kept.
- Only tracked incidents are polled, so historical incidents are never deleted because SIGAE archived them.

## 9. Reference data

- Fix job IDs: `station-${id}`, `vehicle-${id}`.
- Run every reference job once at boot, then on the 12h cron.
- Order: provinces → cantons → districts, stations → vehicles, incident types.
- On-demand: an incident referencing an unknown station or vehicle fetches its details first. Still unknown: station → `MISSING_REFERENCE` and failed poll (FK required); vehicle → `vehicleId = NULL`, keep `vehicleInternalNumber`, log `MISSING_REFERENCE`.

## 10. Migrations

Move from `drizzle-kit push` to committed migrations applied by a dedicated step.

- **Generate:** `drizzle-kit generate` writes SQL migrations into `packages/db/drizzle`, committed with the schema change. Timestamp-prefixed names (`migrations.prefix: "timestamp"` in `drizzle.config.ts`) avoid numbering conflicts between branches. `push` is only for local throwaway databases.
- **Runner:** `packages/db/src/migrate.ts` exports `migrateDatabase(connectionString)`. It opens a small `pg` pool (max 2), takes a Postgres advisory lock with a fixed key, runs drizzle's `migrate()` and closes the pool, which releases the lock. Drizzle's migrator doesn't lock, and the web and sync can deploy at the same time. It uses the same `drizzle.__drizzle_migrations` table as `drizzle-kit migrate`, so either can run against a database the other migrated.
- **Migrate app:** `apps/migrate` loads env, calls `migrateDatabase`, logs the outcome and exits non-zero on failure. Its own Dockerfile installs only the migrate app and `packages/db` in production mode.
- **CI and deploy:** a migrate job builds and pushes the migrate image first; the web and sync jobs `need` it. The server's deploy scripts run the migrate image as a one-shot container before starting the new release, and abort the deploy if it fails.
- **Baseline:** prod was built with `push`, and the existing `0000_fix-invalid-foreign-keys` is a data fix that fails on an empty database. Replace the history with a generated baseline of the current schema:
  1. Check for drift: compare `pg_dump --schema-only` of prod against a fresh database migrated with the baseline. They must match before going further.
  2. Fresh databases (v2 shadow, local, CI) run the baseline normally.
  3. Prod gets the baseline marked as applied with a one-off `db:baseline` script that inserts its hash into `drizzle.__drizzle_migrations` without running it.
- **Drizzle version:** stay on drizzle-orm 0.44 / drizzle-kit 0.31 for this rework. Drizzle 1.0 changes the relational query API used throughout the web app; upgrading is a separate project.

## 11. Web changes

All must work against both databases (v1 data with placeholders, v2 data with `NULL`).

1. Handle `NULL` vehicle times: `dispatchedTime` is assumed non-null in `apps/web/api/routers/incidents.ts` (`.toISOString()`) and `apps/web/api/schemas/incidents.ts` (`z.string()`).
2. Timeline closing event uses `closedAt ?? modifiedAt`.
3. One shared placeholder helper (year ≤ 1970 or null) replacing the three current checks.
4. Show `vehicleInternalNumber` when `vehicle` is null.
5. "En camino" (`isEnRoute` in `api/lib/utils/incidents/response-times.ts`) is currently true for any unit that left the scene without a base-return time. That is about 20% of units, forever. Only show it while the incident is being tracked and the departure was less than 2 hours ago; otherwise show the return time as unknown.
6. Beta mode via env (`SITE_ENV=beta`): `X-Robots-Tag: noindex`, `robots.txt` disallow all, no sitemap, a visible "datos de sync-v2" banner, analytics off.

## 12. Testing

Unit tests in `packages/sync-domain` (pure, no DB/Redis); integration tests in `apps/sync-v2` against a throwaway Postgres migrated with the migrate runner.

### Fixtures

- `fixtures/<scenario>/` with ordered snapshot files (`001.json`, …; each has the four endpoint payloads) and `expected.json` (final state, changes, anomalies).
- A capture script exports a real incident's history from `sigae_snapshots` into a fixture, already redacted.
- Every anomaly code seen during the shadow run gets a fixture before it counts as handled.

### Required cases

- `0001-01-01T00:00:00` → `NULL`; unknown pre-1971 date → `NULL` + anomaly.
- Identical results under `TZ=UTC` and `TZ=America/Costa_Rica`.
- `Fecha` + `Hora_Aviso`, including around midnight.
- Envelope classification for every row in 6.1.
- Partial report: sets fields, never clears them.
- Trailing-dot and unknown incident codes; `0` province/canton/district.
- Responsible station: RESPONSABLE, last-item fallback, empty → `NULL`.
- Coordinates `0`, filled in later, moved.
- `ATENCION A PIE`.
- Unit added; unit removed; all units missing once (kept) and twice (deleted).
- Dispatched but never arrived; time-order violation; dispatch before report time.
- Valid time → placeholder: stored `NULL`, `VALUE_REGRESSED`.
- Open → closed → reopened → closed; discovered already closed; `closedAt` source.
- Not found once (kept), twice (deleted, news articles detached, history kept).
- Lifecycle intervals and transitions, including the 72h settling window and the 30-day cap.
- Redaction: no field outside the allowlists reaches a snapshot or fixture.
- Diff normalizer: prod year-1 placeholders (with their odd offset) compare equal to `NULL`.

## 13. Shadow run

### Branch and workflows

- Work happens on `sync-v2`. `main` keeps its own workflows untouched, so hotfixes can ship from `main` at any time.
- `.github/workflows/build-app-beta.yaml` is a copy of `build-app.yaml` that triggers on `sync-v2`. It tags images `beta`, `beta-<version>` and `beta-sha-<sha>` so it can never overwrite a prod tag. It reads `BETA_VITE_SERVER_URL` / `BETA_VITE_SITE_URL` and calls the `emergenciascr-frontend-beta` deploy hook.
- Added in M4 from the same template: `build-sync-v2-beta.yaml` (needs an `apps/sync-v2` Dockerfile) and `build-migrate-beta.yaml`; web and sync beta jobs depend on the migrate job.
- Server side (manual): the beta deploy hooks, plus services for beta web, sync-v2, Redis and the migrate one-shot.
- At merge time, fold the migrate job and sync-v2 build into the `main` workflows and delete the beta copies.

### Infrastructure

- Database `emergenciascr_v2` on the prod Postgres server, with its own role. v2 has no access to the prod database.
- A read-only role on the prod database for the diff tool.
- Redis for v2 (v1 doesn't use it).
- Reference data comes from v2's own boot-time jobs. No historical incidents are copied; comparisons cover incidents first seen after the start.
- `beta.emergenciascr.com` runs the beta web image with `DRIZZLE_POSTGRES_URL` pointing to `emergenciascr_v2` and `SITE_ENV=beta`.
- Upstream load roughly doubles while both syncs run.

### Diff tool

`bun run --cwd apps/sync-v2 diff --from <date> --to <date>` with `PROD_DB_URL` (read-only) and `V2_DB_URL`.

- Scope: incidents in the window that are `done` in v2, so differences caused by the two syncs polling at different moments are excluded. The rest are listed as "in progress".
- Coverage: incidents missing on either side.
- Field-level comparison of incidents, dispatched stations (by ID) and units (by ID, per time field), after the same normalization on both sides (placeholders → `NULL`, coordinate precision, ignore `modifiedAt` and the new columns).
- Each difference is classified:
  - **expected**: a known v2 improvement (placeholder → `NULL`, removed unit, deleted incident, responsible station `NULL` instead of `0`, late data v1 never picked up).
  - **explained**: v2's change history shows SIGAE sent this value.
  - **unexplained**: needs triage.
- Output: markdown report with counts per field and category, and for each differing incident links to `https://emergenciascr.com/incidentes/<slug>` and `https://beta.emergenciascr.com/incidentes/<slug>` (using the web's slug builder), plus JSON for further analysis. Run daily and keep the reports.

### Duration and exit criteria

At least 7 days including a weekend; 14 preferred. Cut over when:

- Zero unexplained differences for the last 3 days.
- No incidents missing from v2 that v1 has.
- No incidents stuck in `failed`, no unbounded queues.
- Every anomaly code seen has a fixture test.
- A manual side-by-side spot check of prod and beta looks right.

## 14. Cutover

1. Merge `sync-v2` into `main`, folding the beta workflows into the main ones (section 13).
2. Mark the baseline on prod (`db:baseline`), then deploy. The migrate step applies the section 5 migrations.
3. Deploy the section 11 web changes.
4. Stop v1.
5. Point v2 at the prod database. At boot, create `incident_sync_state` rows for prod incidents that are open or closed within the last 72h, then bootstrap as usual.
6. Keep the shadow database for a few weeks, then drop it.
7. Optional: backfill placeholder vehicle times in prod history to `NULL`, then simplify the web placeholder helper.

Rollback: stop v2 and start the old v1 build. All schema changes are compatible with v1.

## 15. Milestones

| #   | Milestone          | Contents                                                                                                                                                                                          |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Verify assumptions | Mostly done (section 3.3). Remaining: unit/station responses for a brand-new incident with no units; prod schema drift check; whether partial reports ever recover to `00` (snapshots will show). |
| M1  | Migrations         | Section 10: runner, migrate app and image, baseline, drift check.                                                                                                                                 |
| M2  | Fix v2 foundations | Section 3.1 bugs: job IDs, error causes, envelope classification, attempt limits, boot-time reference sync, transactions, upstream-driven closing.                                                |
| M3  | Pure core + tests  | `envelope`, `normalize`, `reconcile`, `lifecycle`, `redact` with the section 12 cases.                                                                                                            |
| M4  | History            | Section 5 migrations, snapshots, changes, anomalies, sync state, bootstrap, gap fill, not-found deletion.                                                                                         |
| M5  | Shadow infra       | v2 database and roles, sync-v2 Dockerfile, beta workflows, section 11 web changes, diff tool.                                                                                                     |
| M6  | Shadow run         | 1–2 weeks, daily reports, triage, fixtures for every new anomaly.                                                                                                                                 |
| M7  | Cutover            | Section 14.                                                                                                                                                                                       |

## 16. Open questions

1. **Long-open incidents:** this spec slows polling to hourly after 72h open and stops at 30 days. Acceptable?
2. **Partial reports:** the "set or change but never clear" rule in 6.1 is the one exception to trusting upstream. Acceptable, or should partial reports be written as-is?
3. **Extra report times:** this spec stores `Hora_Controlado` plus the three fire-related times as columns. Store all of them, or only these?
