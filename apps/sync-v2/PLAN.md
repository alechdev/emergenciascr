# sync-v2 plan

How to build what `SPEC.md` describes, in order. The spec says what and why; this file says in which order, what each phase delivers and how to tell it's done. Section numbers refer to the spec.

Every phase is a reviewable set of commits on `sync-v2`. A phase is done when all its "Done when" items are checked. Nothing before phase 8 touches prod (spec section 2, "Prod isolation").

## Overview

| Phase | Name                   | Depends on | Status      |
| ----- | ---------------------- | ---------- | ----------- |
| 1     | Migrations             | —          | Done        |
| 2     | SIGAE client           | —          | Done        |
| 3     | sync-v2 foundations    | 2          | Done        |
| 4     | Schema changes         | 1          | Done        |
| 5     | Pure core and fixtures | 2          | Done        |
| 6     | Sync pipeline          | 3, 4, 5    | Done        |
| 7     | Web changes            | 4          | Done        |
| 8     | Promotion to prod      | 6, 7       | Not started |

Phases 1 and 2 can run in parallel. Phase 5 can start as soon as phase 2 has published its types and `parseSigaeDate`; it needs no database or Redis.

The beta site planned first (its infrastructure, a comparison tool and a beta run) was dropped. A 4-day local run and a comparison with a prod database copy took its place (spec section 13).

## Phase 1: Migrations

Committed migrations applied by a dedicated migrate step (section 10).

**Tasks**

- [x] `migrations.prefix: "timestamp"` in `packages/db/drizzle.config.ts`.
- [x] Replace `0000_fix-invalid-foreign-keys` with one generated baseline of the current schema.
- [x] `packages/db/src/migrate.ts`: `migrateDatabase(connectionString)` with an advisory lock and the standard `drizzle.__drizzle_migrations` table.
- [x] `apps/migrate`: loads env, runs `migrateDatabase`, logs the result, exits non-zero on failure. Its own Dockerfile.
- [x] Repository instructions: how to generate and apply a migration.

**Done when**

- [x] An empty Postgres database migrated with `apps/migrate` matches `drizzle-kit push` output for the same schema (no diff from `drizzle-kit generate`).
- [x] Running the migrate app twice applies nothing the second time.
- [x] Two concurrent runs: one waits for the other, and both exit 0.
- [x] The migrate Docker image builds and migrates a database from a container.

## Phase 2: SIGAE client

One standalone client in `packages/sigae` with proxy support (section 4.1). The old v1 files stay untouched.

**Tasks**

- [x] New entry point `@bomberoscr/sigae/client` with `createSigaeClient`, one method per endpoint in use, `ping()`.
- [x] Wire types (`SigaeDateString`, `Items`/`items`), loose zod schemas, `SigaeResponse` and `SigaeError`.
- [x] Timeouts, concurrency cap, `onResponse` hook, spans and request metrics through `@opentelemetry/api`.
- [x] Proxy on Bun (native `fetch` option) and Node (`undici` `fetch` + `ProxyAgent`).
- [x] Request dates sent as Costa Rica dates; `parseSigaeDate` for replies.
- [x] Tests from section 12 "SIGAE client", with recorded and redacted responses (`test/fixtures/recorded`, from `bun run --cwd packages/sigae record-fixtures`; the hand-written fixtures next to them cover cases SIGAE did not return).

**Done when**

- [x] Unit tests pass on Bun and Node, under `TZ=UTC` and `TZ=America/Costa_Rica` (`bun run --cwd packages/sigae test:tz`).
- [x] Proxy integration tests pass, including `407` and an unreachable proxy.
- [x] `SIGAE_LIVE=1` smoke test passes through an authenticated proxy on Bun and Node. A wrong proxy password gives a `proxy` error on both.
- [x] No import of `@bomberoscr/db`, env, or sync code from the client.

## Phase 3: sync-v2 foundations

Fix what survives the rework: client, env, jobs, telemetry, shutdown. The incident logic itself is replaced in phase 6, so it is not fixed here.

**Tasks**

- [x] sync-v2 and the web admin's manual sync use the new client. Remove `api`, `fetcher` and `types` from `sync-domain`.
- [x] Env: `SIGAE_COD_SYS`, `SIGAE_PROXY_URL`; remove `SENTRY_DSN`. `ping()` at boot.
- [x] Job IDs without colons; attempt limits on every queue; error causes kept (section 3.1 bugs 3, 4, 5). One open-incident job per incident, moved back to delayed between polls and given up after 10 failed updates.
- [x] Reference jobs run once at boot, then on the 12h cron, in the order from section 9.
- [x] Telemetry setup, sync-v2 logger, job metrics, health endpoint (section 4.2).
- [x] Graceful shutdown.
- [x] Remove `@sentry/node`, `@opentelemetry/instrumentation-winston`, `@opentelemetry/resources` 1.x.

**Done when**

- [x] sync-v2 starts locally, syncs all reference data at boot, and logs JSON with no errors.
- [x] Station and vehicle jobs succeed (no "Custom Id cannot contain :").
- [x] Traces, metrics and logs arrive at a local OTLP collector with `service.name=sync-v2` (checked with a minimal OTLP/HTTP JSON receiver, from `tsx` and from the `tsdown` build).
- [x] `SIGTERM` during a job: the job finishes, telemetry is flushed, and it doesn't come back as stalled.
- [x] The web admin's manual sync still works. Its router is not mounted in `api/app.ts` (on `main` either), so its handlers were called directly.

## Phase 4: Schema changes

The section 5 data model as migrations on top of the baseline.

**Tasks**

- [x] All timestamp columns to `timestamptz`. The generated migration converts with `USING ... AT TIME ZONE 'UTC'`, so it doesn't depend on the session timezone.
- [x] Section 5.1 columns: nullable vehicle times, `vehicleInternalNumber`, `closedAt`/`closedAtSource`, the four extra report times.
- [x] Section 5.2 tables: `sigae_snapshots`, `incident_changes`, `sync_anomalies`, `incident_sync_state`.
- [x] Web reads tolerate `NULL` vehicle times (section 11 item 1), so the web keeps working once phase 6 writes them.

**Done when**

- [x] Migrations apply cleanly to an empty database and to a database at the baseline (with synced data and the database timezone set to `America/Costa_Rica`, the stored instants are unchanged).
- [x] Web tests and type checks pass against the new schema. Type checks still report three errors that are on `main` too (`/mapa` link, the health handler, a recharts `payload` prop).
- [x] The web runs locally against a migrated database with sample data that has `NULL` vehicle times.

## Phase 5: Pure core and fixtures

The I/O-free core in `packages/sync-domain` (sections 4, 6, 7, 8), tested without a database or Redis.

**Tasks**

- [x] `poll/`: `classifyPoll` for every row in section 6.1.
- [x] `normalize/`: incident, dispatched units and stations (sections 6.2–6.4).
- [x] `reconcile/`: `diffIncidentState`, `detectAnomalies` (section 7).
- [x] `lifecycle/`: `nextPoll`, including the 72h settling window and the 30-day cap (section 8.2).
- [x] `redact/`: snapshot allowlists (section 5.2).
- [x] Fixture format and the section 12 "Required cases". The capture script comes in phase 6, when snapshots exist.

**Done when**

- [x] Every required case in section 12 that the core owns has a passing test. The rest need later phases: the telemetry fixture poll (phase 6), the shutdown test (phase 6 integration tests; checked by hand in phase 3), the web timezone cases (phase 7) and the comparison tool (phase 9).
- [x] Identical results under `TZ=UTC` and `TZ=America/Costa_Rica` (`bun run --cwd packages/sync-domain test:tz`).
- [x] No module in the core imports the database, Redis, BullMQ or env (checked by `test/purity.test.ts`).

**Notes**

- `processPoll` (`poll/process.ts`) chains the core for one poll: normalize, partial-report rule, incident types, the empty-units rule, lifecycle, `closedAt`, diff and anomalies. Phase 6 wraps it with fetching, snapshots, reference resolution and the transaction.
- Fixtures live in `packages/sync-domain/fixtures/<scenario>/`. Each `NNN.json` holds one poll: `incidentId`, `fetchedAt` and the four endpoint payloads as redacted raw bodies (or a request error). `expected.json` holds every poll's outcome, the changes, the anomalies and the final state; `UPDATE_FIXTURES=1` rewrites it. The current fixtures are synthetic.
- Choices the spec left open:
  - A request failure on any endpoint makes the poll `failed`, even when detail and report answered `03`, so a flaky endpoint can't delete an incident. A `99` report without `Fecha`, `Hora_Aviso`, `Consecutivo`, `DesUbicacion`, `Direccion` or `Estado_Abierto`, or without a usable incident time, is also `failed`.
  - Anomalies that describe a condition (`TIME_*`, `PLACEHOLDER_SHAPE_UNKNOWN`, `UNKNOWN_INCIDENT_TYPE`, `MISSING_REFERENCE`, `UPSTREAM_PARTIAL_REPORT`) are recorded once per incident, row and field, not on every poll. Phase 6 passes the keys already recorded.
  - `TIME_IN_FUTURE` and `TIME_BEFORE_INCIDENT` allow 5 minutes. Coordinates of `0` count as missing for `set`/`cleared` changes and `VALUE_REGRESSED`.
  - `closedAt` is `observed` only when the previous successful poll saw the incident open and happened within twice the scheduled interval (at least 15 minutes); otherwise `estimated`, recomputed on each poll as late data arrives.
  - Failed polls back off from 3 minutes, doubling up to an hour. A second not-found poll less than 3 minutes after the first doesn't count.
  - The empty-units rule only covers units; stations missing from a response are removed right away.

## Phase 6: Sync pipeline

Wire the core into the workers (section 4 pipeline, section 8).

**Tasks**

- [x] Poll worker: fetch, classify, snapshot (only if changed), normalize, diff, anomalies, resolve references, one transaction, schedule the next poll.
- [x] `persist/`: upserts, unit and station removal, changes, anomalies and sync state in one transaction.
- [x] Closing driven by `Estado_Abierto`; `closedAt` and its source (section 8.3).
- [x] Discovery, gap fill and bootstrap from `incident_sync_state` (section 8.1).
- [x] Not-found deletion (section 8.4).
- [x] On-demand reference resolution (section 9).
- [x] Poll, change, anomaly and phase metrics (section 4.2).
- [x] Fixture capture script from `sigae_snapshots` (`bun run --cwd packages/sync-domain capture-fixture`).
- [x] Integration tests against a throwaway Postgres migrated with the migrate runner.
- [x] Vehicle assignment history: `vehicle_station_history` migration, written in the same transaction as every vehicle details upsert (12h job and on-demand), with integration tests (section 5.2, 9).
- [x] Incident type codes SIGAE's type list lacks: create the type from the incident's names, else fall back to the nearest known ancestor; the type sync adopts SIGAE's ID and name later (section 6.3, 9), with unit and integration tests.
- [x] A known location SIGAE clears is kept: coordinates as a pair, province, canton and district as a unit, `LOCATION_CLEARED_UPSTREAM` once per field group (section 6.3, 7), with unit tests and the `location-cleared` fixture.
- [x] Kept coordinates are flagged (`incidents.coordinatesClearedUpstream`, section 5.1, 6.3), and map images follow the coordinates (section 11 item 8): a moved incident gets a new map URL and stored image instead of keeping its first map forever.
- [x] Units-at-station snapshots drop `HoraAtencionAPie` from items without attention on foot, so polls that differ only in SIGAE's clock time store one snapshot (section 5.2), with redaction, pipeline and integration tests.

**Done when**

- [x] Integration tests pass (`bun run test:integration`, both time zones).
- [x] sync-v2 runs locally against SIGAE for 24 hours: no stuck or `failed` incidents, queues don't grow, and incidents move through `active` → `settling` → `done`. It ran 4 days (spec section 13).
- [x] Deleting the Redis data and restarting resumes every tracked incident. Checked against a throwaway Postgres and Redis (`apps/sync-v2/test/integration/discovery.test.ts`). Not repeated during the local run.
- [x] Remaining checks from spec section 3.3: units and stations responses for a brand-new incident with no units (in 5 incidents the first units answer was `03` with empty `Items`, handled as an empty list; stations were never empty on a first poll), and whether partial reports recover to `00` (they don't: 25 of 25 stayed `99`).

**Notes**

- `syncIncident` (`packages/sync-domain/src/pipeline/`) runs one poll: fetch, snapshots, `processPoll`, reference resolution, the transaction (`persist/`) and the next poll time. It takes the database, the SIGAE client, a reference resolver and a clock as arguments, so the poll worker and the web admin manual sync share it. `transform/`, `fetch-incident.ts` and the old `persist/upsert*` files are gone; `@bomberoscr/db/client` builds a database without reading env.
- The poll worker runs one `incident-poll-<id>` job per incident (concurrency 5) and moves it back to delayed until the next poll; the job completes when the incident is `done`, `deleted` or `failed`. Discovery calls `trackNewIncidents` and schedules an immediate poll. Gap fill (`incident-gap-fill`, at boot as `incident-gap-fill-boot` and hourly at `:30`) first reschedules every `active` and `settling` incident from `incident_sync_state`, then lists the last 6 hours.
- Choices the spec left open:
  - The lifecycle `failed` phase (10 consecutive failed polls) replaces the old worker rule of the same name. A database error after the sync state is loaded also counts as a failed poll. A poll that can't load or save the sync state throws; the poll worker then moves the job back to delayed with a backoff (30 s doubling, at most 15 minutes, retry count in the job data until a poll gets through, `sync.job.duration` outcome `retried`) instead of spending attempts, so a database outage doesn't drop incidents. Attempts only cover errors moving the job (Redis down). The poll worker allows 5 stalls (`maxStalledCount`) instead of BullMQ's 1: polling again after a crash is safe under the lock.
  - Snapshots are stored before and outside the poll transaction (in their own, under the incident lock), so they survive a failed poll; each endpoint is stored only when its hash differs from its latest snapshot. Incident data and `modifiedAt` are written only when the poll has changes.
  - An unknown station or vehicle is fetched from SIGAE and upserted before the transaction; unknown incident types refresh the type list. The resolver caches misses for 15 minutes and refreshes incident types at most every 15 minutes. A station created this way has `isOperative` `NULL` until the reference job runs.
  - Still unknown after that: a vehicle is stored with `vehicleId` `NULL`; a province, canton or district (never fetched on demand) is stored as `NULL`; a station fails the poll. Each records `MISSING_REFERENCE` once.
  - The references resolved before a poll include the ones the stored state keeps: a first empty unit list keeps the stored units and a partial report keeps the stored geography, so those count as known instead of becoming `NULL` or failing the poll.
  - Polls of one incident are serialized with a transaction-scoped advisory lock (`lockIncident`, key space `5302026`): the worker and a web admin manual sync can overlap. Under the lock the poll reloads the sync state and the stored state; a poll that finds a newer poll stored is `skipped` (`superseded by a newer poll`): it keeps the snapshots it already stored but writes no incident data, changes, anomalies or sync state, with or without `force`, since writing older data would move `lastPolledAt` back and could reopen or re-close the incident. `force` only bypasses the finished-phase check. The web admin reports a superseded manual sync as synced (`apps/web/api/routers/admin/_lib/sync-result.ts`). SIGAE requests and reference fetches stay outside the lock; the snapshot write and the reference resolution have their own spans (`sync.poll.snapshots`, `sync.poll.references`) next to `sync.poll.transaction`.
  - A forced poll of an incident without a sync state row creates one only when it is `ok` or `partial`; a not-found or failed one stores snapshots and anomalies but no row, so a manual sync of a wrong or old ID never starts polling it or counts toward deleting it. Polls without `force` keep creating the row (the worker only polls tracked incidents, and the fixture replay starts from none).
  - A forced not-found poll of a `deleted` incident is `skipped` (`already deleted`): no second `INCIDENT_DELETED_UPSTREAM`, no sync state change. The web admin reports it as "Incident not found in SIGAE; already deleted".
  - The on-demand station upsert keeps the stored `name` and `stationKey` when the details bring them `NULL` or empty (the reference job may have inserted the row meanwhile); a new row still starts with `""`.
  - Discovery and gap fill schedule listed incidents that are still `active` or `settling` but have no pending job (`rescheduled` in the result), so a job that failed for good comes back within a minute instead of at the hourly resume. The scheduler's per-ID check keeps it idempotent.
  - Boot obliterates the legacy `open-incidents` queue (`LEGACY_QUEUES` in `src/lib/jobs.ts`) when Redis still has keys for it, before syncing the schedulers.
  - `vehicles.internalNumber` is no longer unique (migration `vehicles-internal-number-not-unique`): SIGAE reassigns internal numbers, and the on-demand upsert of the new vehicle failed while the old one still had the number. Nothing reads it as a key. On 2026-10-16 all 420 vehicles had distinct numbers, so the conflict only shows over time.
  - Vehicle assignment history (`vehicle_station_history`, migration `vehicle-station-history`): `upsertVehicleDetails` (`packages/sync-domain/src/persist/references.ts`) is the only writer of `vehicles` and now takes the time of the observation; it upserts the vehicle and writes the history in one transaction (a savepoint when the caller already has one), for both the 12h reference job (one `vehicle-<id>` job, so one transaction, per vehicle; about 420 small transactions every 12 hours, so no batching) and the on-demand fetch (the resolver's clock). It compares against what the upsert returns (`RETURNING`), so a `null` status from SIGAE compares as the stored one; the `""` placeholder of a vehicle that never had a status is `NULL` in the history. The decision is pure (`reconcile/vehicle-assignment.ts`). No extra lock: the upsert locks the vehicle's row until commit (a new vehicle's insert waits for a concurrent one, then updates it), and the latest history row is read after it, so concurrent writers of one vehicle take turns and can't both start a row for the same change. A bump never moves `lastSeenAt` back (`greatest`), for a writer whose clock reading is older. A vehicle stored before the migration has no history until its next observation.
  - The poll scheduler only adds incidents without a pending job and returns how many it added (BullMQ's `addBulk` returns existing jobs as if added), so gap fill reports real counts.
- Integration tests (`bun run test:integration` from the root, Docker): `scripts/test-integration.sh` starts `postgres:17-alpine` and `redis:7-alpine` on random loopback ports and runs `test:integration` in `packages/sync-domain`, `apps/sync-v2` and `packages/db` (phase 7) under `TZ=UTC` and `TZ=America/Costa_Rica`. The tests only read `TEST_DATABASE_URL` and `TEST_REDIS_URL` (loopback only, never the app's URLs) and skip without them. Since they truncate and flush, the database name must contain `test`, a database with tables must have `__integration_test_marker` (created in an empty database before migrating, checked again before every truncate), and Redis must select a database other than 0 (the script uses `/15`); the suites use `flushdb`, never `flushall`. They cover: every fixture replayed through `syncIncident` against `expected.json`; transaction rollback; not-found deletion; on-demand stations, vehicles and incident types; concurrent and superseded polls; manual sync with `force`; the real queue through `active` → `settling` → `done`, the 72h and 30-day caps and the failure backoff; discovery, gap fill and the resume after a Redis flush; the capture script; telemetry with in-memory exporters (span names, no incident IDs in metric attributes, no SIGAE data or credentials in logs); and SIGTERM on the real service in a child process (the running poll finishes and is stored, telemetry is flushed over OTLP, exit code 0).
- The capture script reads `sigae_snapshots` through `CAPTURE_DATABASE_URL` only, on a read-only session, and writes one poll per distinct snapshot time with every endpoint's latest snapshot. It redacts again with the current allowlists, replaces addresses with numbered `DIRECCION DE PRUEBA n` and coordinates with a synthetic point that keeps their offsets (so changes and moves survive), and checks the result before writing: allowlisted fields only, synthetic addresses, and coordinates that start exactly at the synthetic point and stay within 0.5° of it (`0` and `null` kept). A capture whose incident moved further is refused and has to be reviewed by hand. Snapshots are only stored when a payload changes and failed requests aren't stored, so a capture can't show repeated identical answers (the second not-found, the second empty unit list) or failed requests; add those polls by hand. Then `UPDATE_FIXTURES=1` creates `expected.json`; the fixture runner treats every station and vehicle as known and uses the synthetic incident type list.
- Reviewed and kept: the annual recap's vehicle chart doesn't key by `internalNumber`, now that it isn't unique: the query groups by `vehicles.id`, the chart's React keys use the rank, and other vehicle lists key by `vehicle.id`. Recorded anomaly keys are loaded on every poll (one indexed query per incident); gap fill keeps list items without a usable time (it can't tell how old they are, and polling an old one once is cheap).
- Spec section 3.3 recheck on 2026-10-16 (read-only, 24 requests, aggregates only, no proxy): the three freshest incidents (10, 24 and 58 minutes old) answered `00` on all four endpoints with one station and one unit each; unit and station envelopes are `Codigo`, `Descripcion`, `Items`. No new incident appeared during about 12 minutes of relisting; the brand-new incident case was settled later from the run's snapshots (spec section 3.3).
  - The web admin manual sync calls `syncIncident` with `force`, so it also polls `done`, `deleted` and `failed` incidents and records changes and sync state like the worker (with the exceptions above for superseded, untracked and already deleted incidents).
- 24-hour run: started 2026-10-16 with the Compose stack in `apps/sync-v2/local-run/` (the sync-v2 and migrate images, Postgres, Redis and Grafana LGTM, loopback only; see its README for commands, the checklist and the run log). The stack came up at 20:00 UTC; sync-v2 was redeployed at 20:19 UTC (14:19 Costa Rica) with the fix below, and the 24 hours count from there.
  - Fixed during the run: at boot the first polls (concurrency 5) ran while the reference job was still on stations, met the same unknown incident type codes, and only the first one refreshed the list; the others hit the 15-minute throttle and stored `NULL` codes with `UNKNOWN_INCIDENT_TYPE` (12 anomalies on 3 incidents; the next poll filled the codes). Concurrent polls now share the refresh in flight (`createReferenceResolver`).
  - Fixed after the run: `ObtenerTiposIncidente` only lists the top-level categories 1–9 and 98, but incidents use categories `10` ("SERVICIOS ESPECIALES", e.g. `10.3` "INTER-INSTITUCIONAL") and `11` ("SERVICIOS DECLINADOS", `11.1`). Three incidents were affected: one stored all four codes as `NULL` on every poll, and two that SIGAE reclassified to `11`/`11.1` had their known codes (`3`/`3.3`, `7`/`7.1.1`) cleared to `NULL` (`VALUE_REGRESSED` and `UNKNOWN_INCIDENT_TYPE`). The detail response sends each code with its name, so an unknown code with a name now creates its type, and one without a name stores its nearest known ancestor (section 6.3). Created types have negative IDs, so no schema change: `insertInferredIncidentTypes` (`packages/sync-domain/src/persist/references.ts`) takes a transaction-scoped advisory lock (namespace `5302027`), takes the next negative ID and inserts with `ON CONFLICT (incident_code) DO NOTHING`, in the poll's transaction before the incident. `upsertIncidentTypes` takes the same lock in one transaction: a created code SIGAE now lists gets SIGAE's ID and name (its children are detached first, since `parent_id` points at the old ID), then every remaining created type is linked to its nearest existing ancestor. `findKnownReferences` also reads the ancestors of the codes and which ones are created (`inferredIncidentTypes`). `UNKNOWN_INCIDENT_TYPE` details gained `storedCode` and `resolution`, and its key includes the code, so a reclassification to another unknown code is recorded again; anomalies recorded before keep matching.
  - Reviewed and kept: the web reads `incident_types` by code, and the types API compares `parentId` by truthiness (`apps/web/api/routers/types.ts`), so negative IDs work. Created top-level types (`10`, `11`) show up as categories in the incident type filter and the station charts, like SIGAE's.
  - Fixed after the run: SIGAE clears an incident's location for a while (operator edits), with both endpoints answering `00`. In three incidents the detail's `latitud`/`longitud` went from known to `0` and back on a later poll, after 3 minutes in one and after several hours in the other two (16 hours in the longest, which came back with slightly different coordinates); in that one the report's `Id_Provincia`, `Id_Canton` and `Id_Distrito` went to `0` and back at the same polls. sync-v2 followed SIGAE: `cleared` changes, `VALUE_REGRESSED`, and the site would have shown those incidents without a location for hours. Now a known location is never cleared (section 6.3): `keepKnownLocation` (`packages/sync-domain/src/reconcile/location.ts`) runs in `processPoll` after the partial-report rule and before incident types and references, like the empty-units rule, so it is pure and sees both the stored and the polled state. The stored values it keeps are already in the poll's references (`pollReferences` merges the stored state's), and it hands what it kept to `detectAnomalies` (`keptLocations`), which records `LOCATION_CLEARED_UPSTREAM` as a condition, keyed by field group, so a clearing that lasts 16 hours records it once. The snapshots keep SIGAE's zeros.
  - Fixed after the run: SIGAE answers `HoraAtencionAPie` with its current clock time (Costa Rica time) when `AtencionAPie` is `false`, so every poll stored a new `ObtenerEstacionesAtiendeIncidente` snapshot: 10,214 in 24 hours, all distinct. Without the field on those items, 201 are distinct per incident and payload; the one item with `AtencionAPie` `true` had a stable time. Normalization already ignored the field. Snapshots now drop it from items whose `AtencionAPie` isn't `true` (section 5.2), before hashing: the allowlists gained a conditional rule (`{ when: { field, equals } }` in `packages/sync-domain/src/redact/allowlists.ts`), which the capture script's key ordering and the redaction tests understand. The hand-written fixtures keep the field (with `0001-01-01T00:00:00`) as an answer would have it, since the poll redacts it, and so do the SIGAE client's recorded fixtures, which test decoding what SIGAE sends; captures from older snapshots drop it when they redact again. Snapshots stored before the change are not migrated.
  - Seen, not changed: a vehicle job left waiting by a shutdown can finish (and be removed, `removeOnComplete`) between the restarted reference job's `addBulk` and `waitUntilFinished`, which then rejects with `Missing key for job … isFinished`. The reference job's attempt fails with `warn` and its retry syncs the vehicles (1 of 420 after a restart mid-run).

## Phase 7: Web changes

The rest of section 11, built and tested against a local migrated database.

**Tasks**

- [x] Closing event uses `closedAt ?? modifiedAt`.
- [x] One shared "missing date" helper.
- [x] `vehicleInternalNumber` when the vehicle is unknown.
- [x] "En camino" fix.
- [x] Costa Rica time everywhere: shared formatter, slugs, date filters, SQL buckets, current year.
- [x] Station vehicle list and annual recap count dispatches by `dispatched_vehicles.stationId`, not the vehicle's current station (section 11 item 7).

**Done when**

- [x] Web tests pass under `TZ=UTC`, including the 20:25 Costa Rica evening incident case (`bun run --cwd apps/web test:tz`).
- [x] No bare `toLocaleString` / `toLocaleTimeString` / `Intl.DateTimeFormat` without the shared module remain in the web (`apps/web/src/lib/date-formatting-guard.test.ts`).
- [x] A vehicle moved from station A to station B: B's vehicle list shows it without A's dispatches, and A's past incidents still show A (`packages/db/test/integration/station-dispatches.test.ts`).

**Notes**

- Closing event: `buildTimelineEvents` (`apps/web/api/lib/utils/incidents/timeline.ts`) dates "Incidente cerrado" at `closedAt`, else `modifiedAt` (incidents closed before `closedAt` existed, or a placeholder), still only for closed incidents. The incident API exposes `closedAt` and `closedAtSource` in the incident and list responses; the generated client (`src/lib/api/types.gen.ts`) is regenerated with `openapi-ts -i` from the API's `/api/doc`, dumped by importing the app in an empty directory with placeholder settings (no `.env`, no database connection).
- Unknown vehicles: `getDispatchedVehicleLabel` (`apps/web/api/lib/utils/incidents/formatters.ts`) labels a dispatched unit with its vehicle's `internalNumber`, else the dispatch's `vehicleInternalNumber`, else `N/A`. The timeline, response times, station summary (incident page and markdown) and the incident API's dispatched vehicles use it, and the incident queries load `vehicleInternalNumber`. A known vehicle keeps its current number, as the spec says; the stored one only fills in for a `NULL` vehicle.
- "En camino": `isVehicleEnRoute` (`apps/web/api/lib/utils/incidents/response-times.ts`) needs a departure, no base return time, a departure less than 2 hours before now, and a tracked incident: `incident_sync_state.phase` `active` or `settling` (`isIncidentTracked`). The incident queries load the phase through a new `incidents.syncState` relation (no foreign key and no migration, like the table), so it is one join and not an API field; an incident without a sync state row is not tracked. Otherwise `isEnRoute` is `false` and the return time stays unknown as before (`returnTimeSeconds` 0). `buildIncidentResponseTimes` takes `now` (also for the time on scene of an open incident), for tests. The response-times endpoint caches for a minute while a unit is en route, not 3 hours, since a closed (`settling`) incident can still show it.
- Station views: `getStationVehiclesWithStats` (`packages/db/src/queries/stations.ts`) still lists the vehicles assigned to the station now (`vehicles.stationId`), and counts and averages only their dispatches with `dispatched_vehicles.stationId` equal to it, from a subquery joined to the incidents. That join also fixes the 30-day window the page announces ("últimos 30 días"): the old left join on `incidents` filtered nothing, so the counts covered every dispatch ever. The annual recap's top vehicles (`getYearRecap` in `stats.ts`) group by vehicle and dispatch station and take the station's name from `dispatched_vehicles.stationId`, so a vehicle that served two stations in the year has a row for each, with that station's count. One row with the total under one of its stations would misstate either the count or the station. The recap chart keys by rank and the axis by rank label, so a vehicle appearing twice is safe. The SQL time buckets were left to the Costa Rica time change (below).
- `getStationVehiclesWithStats`, `getYearRecap` and `getIncidentById` take an optional database (default the shared one) and the first an optional `now`, for the integration tests. Those run in `packages/db` (`bun run --cwd packages/db test:integration`, part of `bun run test:integration`) through the sync-domain harness, like the sync-v2 suites: same throwaway database, guards and migrations, and a setup file that points `DRIZZLE_POSTGRES_URL` at an unreachable loopback port before the queries import `@bomberoscr/db/index` (this package has a `.env`).
- Costa Rica time: `@bomberoscr/lib/costa-rica-time` (`packages/lib/src/costa-rica-time.ts`), used by the API, the Start app (server and browser) and `packages/db`. `formatCostaRicaDate` formats with `timeZone: "America/Costa_Rica"` and named presets that keep the site's `es-CR` output ("10 de octubre de 2026 a las 8:25 p. m."; an invalid date gives `""` rather than throwing in a server render); the charts keep `en-US` with the Costa Rica zone. The calendar helpers give wall-clock parts, `YYYY-MM-DD` day keys, the Costa Rica year, and the start of a Costa Rica day, hour, month and year. Wall-clock times convert through `Intl` with the zone's rules, not a fixed `-06:00`, since Costa Rica observed DST in 1979–1980 and 1991–1992. Date pickers and date-fns calendar math keep local `Date`s that name a day (`calendarDateFromKey`, `getCalendarDateKey`, `getCostaRicaCalendarToday`), and turn them into instants only through the Costa Rica day helpers.
  - Formatting: incident article, timeline, response times, relative time tooltip, OG image, incident and station markdown, meta, Open Graph and JSON-LD descriptions (`buildIncidentDescription`, `src/lib/incident-description.ts`), annual recap, daily response times, chart date labels, and the stats router, whose own Costa Rica midnight and hour helpers are gone. Numbers still use `toLocaleString("es-CR")`.
  - Slugs: `buildIncidentSlug` ends with the Costa Rica date, so 1923918 is `1923918-incendio-estructural-2026-10-10`. The old `...-2026-10-11` gets a 301 from the page loader and the markdown handler (`src/server/incidents/slug-redirect.test.ts`). The unused slug copies in `src/lib/utils.ts` are removed.
  - Date filters: `src/components/incidents/date-range.ts` runs a range from Costa Rica midnight on the first day to the last millisecond of the last, shows a searched instant as its Costa Rica day, and defaults to the last 7 Costa Rica days. The station heatmap counts from today in Costa Rica, and `searchIncidentsCoordinates` uses whole Costa Rica days.
  - SQL: `packages/db/src/queries/costa-rica-time.ts` (`inCostaRica`, `costaRicaDayKey`, `costaRicaHourKey`, `costaRicaMonthKey`, `costaRicaHourOfDay`, `costaRicaDayOfWeek`) converts with `AT TIME ZONE 'America/Costa_Rica'`, inlined so the `SELECT` and `GROUP BY` expressions are identical, and returns keys with `to_char`, so they don't depend on `DateStyle` either. It replaces every bucket in `stats.ts`, `stations.ts`, `map/stationsCharts.ts` and `sitemap.ts`, whose month pages now select the Costa Rica month by range. Ranges built in JS (recap and incident statistics years, daily incidents, station heatmap cutoff, hourly chart) start at Costa Rica midnight or hour. These queries take an optional database (and `getStationIncidentsPerDay` a `now`) for `packages/db/test/integration/costa-rica-buckets.test.ts`, which runs them in UTC, `Asia/Tokyo` and Costa Rica sessions: 20:25 on 10 October counts on the 10th, at 20:00, on a Saturday and in October, and 23:30 on 31 December stays in its year and month.
  - Current year: the article, markdown context (which takes `now`), footer and the year recap's default year (`api/schemas/stats.ts`) use `getCostaRicaYear`. The default is now computed per request; it was evaluated once at module load, so a server running across New Year kept the old year. The generated client has no default, so it is unchanged. The API still returns UTC ISO strings.
  - Tests: `bun run --cwd apps/web test:tz` runs the web tests under `TZ=UTC` and `TZ=America/Costa_Rica` (also checked under `Asia/Tokyo` and `America/Los_Angeles`). A guard test fails on `toLocaleDateString`, `toLocaleTimeString` or `Intl.DateTimeFormat` outside the shared module; `toLocaleString` on a date isn't caught by it, and none remains.
  - Left as they are: the homepage's rolling N-day windows (highlighted incidents, incident types chart) are instants N×24 h back, not calendar days; the admin SIGAE date at noon `-06:00` only names a day.
- Missing dates: `isKnownDate` / `isMissingDate` (`packages/lib/src/missing-date.ts`, `@bomberoscr/lib/missing-date`), since both the API and the Start app's client components need it and `src/` components don't import `@api/*`. It replaced four checks: `isUndefinedDate` in the API formatters and in `src/lib/utils.ts` (local year `=== 1`), the response-time table's local year `=== 1970`, and the markdown page's local year `> 1970`. A time is missing when it is `null`, empty, unparsable, or its UTC year is 1970 or earlier (SIGAE's `0001-01-01` placeholder, which the legacy data still has, and the epoch). The year is read in UTC because in Costa Rica the placeholder's local year is 0, so the old `=== 1` checks missed it on a server or browser in Costa Rica time.
- Beta mode (`SITE_ENV=beta`: noindex, robots, no sitemap, banner, no analytics) was built and then removed with the beta site.

## Phase 8: Promotion to prod

Merge `sync-v2` into `main`, migrate the prod database in place and replace v1 (spec section 14).

**Tasks**

- [ ] Rehearsal on a local restore of a prod dump: schema drift check against the baseline, drift fixes, baseline marked as applied, `apps/migrate` run and timed.
- [ ] The new web against the migrated copy: incident pages (old and new), stats, slugs and their 301s, maps.
- [ ] sync-v2 against the migrated copy for a while: it picks up existing rows (the first poll diffs v1's data) and new incidents.
- [ ] Decide the handoff window (spec section 16).
- [ ] Runbook from the rehearsal: exact commands, backup, timings, checks and rollback.
- [ ] Before the switch: explicit histogram buckets (`packages/sigae/src/client/telemetry.ts`), the BullMQ `removeOnComplete` race, the `tsx` dev dependency, `dispatched_vehicles` indexes, a CI test workflow, and a regenerated API client (`src/lib/api/*.gen.ts`).
- [ ] `main` workflows: migrate job and sync-v2 image build; the web and sync deploys need the migrate job.
- [ ] Server: Redis, the sync-v2 service, the migrate one-shot, `SIGAE_PROXY_URL`, an OTLP endpoint with `deployment.environment.name=production`, and the dashboard.
- [ ] Merge `sync-v2` into `main`.
- [ ] Switch following the runbook.
- [ ] Remove v1 (`apps/sync` and what only it uses) once the switch is accepted.

**Done when**

- [ ] The rehearsal migrates a prod copy cleanly, and the new web shows its history correctly.
- [ ] A failing migration stops the deploy.
- [ ] Prod runs sync-v2: new incidents appear, none end in `failed`, queues stay flat, and the dashboard shows live data.
- [ ] v1 is stopped and removed.

**Notes**

- `apps/sync-v2/Dockerfile` (built with the old beta phase) follows the migrate one: the build stage installs the filtered workspace and bundles with tsdown (workspace packages, `drizzle-orm`, `pg` and `undici` end up in `dist/`), the runtime stage gets a production-only install of sync-v2's own dependencies, runs as `bun` with `bun run --no-install dist/index.mjs`, and checks `/health` on loopback. It runs on Bun 1.4 (`start` in `package.json` too): the built bundle passed the SIGTERM integration test (poll finished and stored, traces, metrics and logs flushed, exit 0) on both Bun and Node, the spec assumes Bun in deploy images, and the image needs no second runtime. The SIGAE client only loads `undici` on Node, for the proxy. The shutdown takes up to 45 seconds, so the container's stop timeout must be longer (the local stack uses 60 s). `.dockerignore` now excludes `.env` files in every directory, not just the root.
