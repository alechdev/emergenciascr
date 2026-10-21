# sync-v2

A sync program that syncs the latest incidents attended by Bomberos de Costa Rica and related reference data from SIGAE into a database. Built with BullMQ queues and workers with scheduled jobs and controlled concurrency.

Rewrite of [sync (v1)](../sync/) that heavily uses `neverthrow` for explicit, predictable error handling, which helps deal with unreliable responses from the SIGAE API. It talks to SIGAE through the client in [`packages/sigae`](../../packages/sigae). The rework in progress is described in [SPEC.md](./SPEC.md) and [PLAN.md](./PLAN.md).

## What it syncs

| Task               | Frequency                                                  |
| ------------------ | ---------------------------------------------------------- |
| Incident discovery | Every minute (the latest 50 incidents)                     |
| Discovery gap fill | At boot, then every hour at `:30` (the last 6 hours)       |
| Incident polls     | Per incident, on the lifecycle schedule (spec section 8.2) |
| Reference data     | At boot, then every 12 hours                               |

Reference data runs as one `reference` job, in order: provinces, cantons and districts; stations; vehicles; incident types; vehicle availability. Stations and vehicles fan out one job per item (`station-<id>`, `vehicle-<id>`) with limited concurrency, so outbound requests don't spike. Each time a vehicle's details are stored (by its job or fetched on demand by a poll), the same transaction records its station and operational status in `vehicle_station_history`: the latest row's `lastSeenAt` moves while both stay the same, and a change starts a new row. `vehicles` only holds the current values. A kind that fails doesn't stop the others, and a retry skips the kinds that already succeeded.

## How it works

- Discovery tracks new incidents in `incident_sync_state` and adds one `incident-poll-<id>` job per incident. Gap fill reschedules every `active` and `settling` incident from `incident_sync_state` (so deleting the Redis data loses nothing), then lists the last 6 hours to catch incidents discovery missed. Both also give listed incidents that are still `active` or `settling` their job back when it is gone (it failed for good, or Redis lost it).
- Each poll runs `syncIncident` from [`packages/sync-domain`](../../packages/sync-domain): fetch the four endpoints, store changed snapshots, normalize, diff, detect anomalies, resolve unknown stations, vehicles and incident types on demand, write the incident, its changes and anomalies and the next sync state in one transaction and compute the next poll. Snapshots are stored in their own transaction before it, and references fetched on demand are upserted as they arrive, so both stay when the poll fails afterwards. The job then moves itself back to delayed until that time, so an incident has at most one pending job. It completes when the incident is `done` (settled after closing), `deleted` (not found upstream twice) or `failed` (10 consecutive failed polls).
- Polls of one incident never write at the same time (the worker and a web admin manual sync can overlap): the transaction holds a Postgres advisory lock on the incident, and a poll that finds a newer one already stored is skipped (`incident poll superseded`), whether it is the worker's or a manual sync's: `force` only lets a manual sync poll `done`, `deleted` and `failed` incidents. A manual sync of an incident that sync-v2 doesn't track yet starts tracking it only when SIGAE answers for it, so a not-found never leads to its deletion, and a manual sync of a `deleted` incident that is still not found changes nothing (`already deleted`).
- Every poll logs one summary line and records the `sync.poll.*`, `sync.changes` and `sync.anomalies` metrics. Discovery records `sync.discovery.delay`, and `sync.incidents` counts incidents by phase every minute.
- Every queue has an attempt limit. Failed attempts are logged as `warn`, the last one as `error`, with the full cause chain.
- A poll that can't load or save its sync state (the database is down) doesn't spend attempts: the job is moved back to delayed with a backoff (30 seconds, doubling, at most 15 minutes) and logged as `warn`, and `sync.job.duration` records it as `retried`. A poll job may stall 5 times (a crash mid-poll) before BullMQ fails it.
- At boot, what is left of the legacy `open-incidents` queue (jobs and schedulers) is removed from Redis.

## Configuration

See [`.env.example`](./.env.example). `SIGAE_PROXY_URL` is optional; when set, every SIGAE request goes through it. At boot the service pings SIGAE and logs the result; a failed ping is logged but doesn't stop it.

## Observability

- Logs are JSON lines on stdout (pretty in `NODE_ENV=development`), plus OpenTelemetry. They never contain SIGAE bodies, credentials or the proxy URL.
- Each poll is a `sync.poll` span with the SIGAE requests and `sync.poll.snapshots`, `sync.poll.references` and `sync.poll.transaction` inside.
- Traces, metrics and logs are exported over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and configured with the standard `OTEL_*` variables. Without an endpoint, export is off.
- `GET /health` on `HEALTH_HOST:HEALTH_PORT` (loopback by default) answers `503` when Redis or the database is unreachable. The time since the last successful SIGAE response is in the body but doesn't fail the check.

## Shutdown

On `SIGTERM` or `SIGINT` the service closes every worker (running jobs get up to 30 seconds to finish), then queues, Redis, the database pool and the SIGAE client, flushes telemetry and exits. A shutdown still running after 45 seconds exits with code 1. A reference job interrupted by a shutdown resumes after the restart.

## Development

From the repository root:

```sh
cp apps/sync-v2/.env.example apps/sync-v2/.env   # then fill in the SIGAE values
cp apps/sync-v2/.env.example apps/migrate/.env   # migrate only reads DRIZZLE_POSTGRES_URL
bun run --cwd apps/migrate start   # apply migrations
bun run --cwd apps/sync-v2 dev
```

## Tests

- `bun run --cwd apps/sync-v2 test`: unit tests, no servers needed.
- `bun run test:integration` (from the repository root, needs Docker): starts a throwaway Postgres and Redis on random loopback ports, runs the integration tests of `packages/sync-domain` and `apps/sync-v2` under `TZ=UTC` and `TZ=America/Costa_Rica`, and removes both containers.
- `bun run --cwd apps/sync-v2 test:integration` runs them against servers you started yourself, given `TEST_DATABASE_URL` and `TEST_REDIS_URL` (loopback only; never the app's `DRIZZLE_POSTGRES_URL` or `REDIS_URL`). Without both, every suite is skipped. The tests empty the database and flush the Redis database, so they refuse a database without `test` in its name, a database with tables they didn't create (they create `__integration_test_marker` in an empty one before migrating it) and Redis database 0: use something like `redis://127.0.0.1:6379/15`.

The integration tests cover the real queue and lifecycle schedule, discovery, gap fill and the resume after losing Redis, the fixtures replayed through `syncIncident`, on-demand references, concurrent polls, telemetry with in-memory exporters and a graceful shutdown of the real service in a child process.
