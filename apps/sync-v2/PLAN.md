# sync-v2 plan

How to build what `SPEC.md` describes, in order. The spec says what and why; this file says in which order, what each phase delivers and how to tell it's done. Section numbers refer to the spec.

Every phase is a reviewable set of commits on `sync-v2`. A phase is done when all its "Done when" items are checked. Nothing here touches prod (spec section 2, "Prod isolation").

## Overview

| Phase | Name                   | Depends on | Status                          |
| ----- | ---------------------- | ---------- | ------------------------------- |
| 1     | Migrations             | —          | Done                            |
| 2     | SIGAE client           | —          | Done                            |
| 3     | sync-v2 foundations    | 2          | Done                            |
| 4     | Schema changes         | 1          | Done                            |
| 5     | Pure core and fixtures | 2          | Not started                     |
| 6     | Sync pipeline          | 3, 4, 5    | Not started                     |
| 7     | Web changes            | 4          | Not started                     |
| 8     | Beta infrastructure    | 1, 6, 7    | Not started                     |
| 9     | Comparison tool        | 8          | Not started                     |
| 10    | Beta run               | 9          | Not started                     |
| —     | Promotion to main      | 10         | Planned separately (section 14) |

Phases 1 and 2 can run in parallel. Phase 5 can start as soon as phase 2 has published its types and `parseSigaeDate`; it needs no database or Redis.

Phase 8 may also start early, right after phase 3, to try the proxy, telemetry and deploy hooks on the server sooner. If so, reset the beta database before phase 10 so the beta run starts with data from the final sync.

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

- [ ] `poll/`: `classifyPoll` for every row in section 6.1.
- [ ] `normalize/`: incident, dispatched units and stations (sections 6.2–6.4).
- [ ] `reconcile/`: `diffIncidentState`, `detectAnomalies` (section 7).
- [ ] `lifecycle/`: `nextPoll`, including the 72h settling window and the 30-day cap (section 8.2).
- [ ] `redact/`: snapshot allowlists (section 5.2).
- [ ] Fixture format and the section 12 "Required cases". The capture script comes in phase 6, when snapshots exist.

**Done when**

- [ ] Every required case in section 12 has a passing test.
- [ ] Identical results under `TZ=UTC` and `TZ=America/Costa_Rica`.
- [ ] No module in the core imports the database, Redis, BullMQ or env.

## Phase 6: Sync pipeline

Wire the core into the workers (section 4 pipeline, section 8).

**Tasks**

- [ ] Poll worker: fetch, classify, snapshot (only if changed), normalize, diff, anomalies, resolve references, one transaction, schedule the next poll.
- [ ] `persist/`: upserts, unit and station removal, changes, anomalies and sync state in one transaction.
- [ ] Closing driven by `Estado_Abierto`; `closedAt` and its source (section 8.3).
- [ ] Discovery, gap fill and bootstrap from `incident_sync_state` (section 8.1).
- [ ] Not-found deletion (section 8.4).
- [ ] On-demand reference resolution (section 9).
- [ ] Poll, change, anomaly and phase metrics (section 4.2).
- [ ] Fixture capture script from `sigae_snapshots`.
- [ ] Integration tests against a throwaway Postgres migrated with the migrate runner.

**Done when**

- [ ] Integration tests pass.
- [ ] sync-v2 runs locally against SIGAE for 24 hours: no stuck or `failed` incidents, queues don't grow, and incidents move through `active` → `settling` → `done`.
- [ ] Deleting the Redis data and restarting resumes every tracked incident.
- [ ] Remaining checks from spec section 3.3: units and stations responses for a brand-new incident with no units.

## Phase 7: Web changes

The rest of section 11, built and tested against a local migrated database.

**Tasks**

- [ ] Closing event uses `closedAt ?? modifiedAt`.
- [ ] One shared "missing date" helper.
- [ ] `vehicleInternalNumber` when the vehicle is unknown.
- [ ] "En camino" fix.
- [ ] Costa Rica time everywhere: shared formatter, slugs, date filters, SQL buckets, current year.
- [ ] Beta mode (`SITE_ENV=beta`).

**Done when**

- [ ] Web tests pass under `TZ=UTC`, including the 20:25 Costa Rica evening incident case.
- [ ] No bare `toLocaleString` / `toLocaleTimeString` / `Intl.DateTimeFormat` without the shared module remain in the web.
- [ ] With `SITE_ENV=beta`: `noindex` header, `robots.txt` disallow, no sitemap, banner shown, analytics off.

## Phase 8: Beta infrastructure

Everything needed to run beta on the server (section 13).

**Tasks**

- [ ] Database `emergenciascr_v2` and its own role on the same Postgres server.
- [ ] `apps/sync-v2` Dockerfile.
- [ ] Workflows `build-migrate-beta.yaml` and `build-sync-v2-beta.yaml`; web and sync jobs need the migrate job.
- [ ] Server: services for beta web, sync-v2, Redis and the migrate one-shot; deploy hooks; `SIGAE_PROXY_URL`; OTLP endpoint with `deployment.environment.name=beta`.
- [ ] Beta dashboard (section 4.2).

**Done when**

- [ ] A push to `sync-v2` builds all three images and deploys migrate, then web and sync.
- [ ] A failing migration stops the deploy.
- [ ] `beta.emergenciascr.com` shows incidents synced by sync-v2.
- [ ] The dashboard shows live data from beta.
- [ ] Nothing on the branch has prod database credentials.

## Phase 9: Comparison tool

`bun run --cwd apps/sync-v2 compare` (section 13, "Comparison tool").

**Tasks**

- [ ] Fetch from both sites' public APIs, throttled to about 2 requests per second.
- [ ] Coverage checks, field comparison with tolerances, classification (expected, explained, unexplained).
- [ ] Markdown report and JSON output.
- [ ] Tests with recorded API responses.

**Done when**

- [ ] Tests pass.
- [ ] A run over the first days of beta produces a report where every difference is classified.

## Phase 10: Beta run

At least 7 days including a weekend, 14 preferred (section 13, "Duration and acceptance").

**Tasks**

- [ ] Daily comparison report, kept.
- [ ] Triage every unexplained difference: fix the sync, or add a rule to the comparison tool with a reason.
- [ ] A fixture test for every anomaly code seen.

**Done when**

- [ ] All acceptance criteria in section 13 are met.
- [ ] Remaining checks from spec section 3.3: whether partial reports ever recover to `00` (from snapshots).

Then plan the promotion to main (section 14) as its own document.
