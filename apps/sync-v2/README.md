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

Reference data runs as one `reference` job, in order: provinces, cantons and districts; stations; vehicles; incident types; vehicle availability. Stations and vehicles fan out one job per item (`station-<id>`, `vehicle-<id>`) with limited concurrency, so outbound requests don't spike. A kind that fails doesn't stop the others, and a retry skips the kinds that already succeeded.

## How it works

- Discovery tracks new incidents in `incident_sync_state` and adds one `incident-poll-<id>` job per incident. Gap fill reschedules every `active` and `settling` incident from `incident_sync_state` (so deleting the Redis data loses nothing), then lists the last 6 hours to catch incidents discovery missed.
- Each poll runs `syncIncident` from [`packages/sync-domain`](../../packages/sync-domain): fetch the four endpoints, store changed snapshots, normalize, diff, detect anomalies, resolve unknown stations, vehicles and incident types on demand, write everything in one transaction and compute the next poll. The job then moves itself back to delayed until that time, so an incident has at most one pending job. It completes when the incident is `done` (settled after closing), `deleted` (not found upstream three times) or `failed` (10 consecutive failed polls).
- Every poll logs one summary line and records the `sync.poll.*`, `sync.changes` and `sync.anomalies` metrics. Discovery records `sync.discovery.delay`, and `sync.incidents` counts incidents by phase every minute.
- Every queue has an attempt limit. Failed attempts are logged as `warn`, the last one as `error`, with the full cause chain.

## Configuration

See [`.env.example`](./.env.example). `SIGAE_PROXY_URL` is optional; when set, every SIGAE request goes through it. At boot the service pings SIGAE and logs the result; a failed ping is logged but doesn't stop it.

## Observability

- Logs are JSON lines on stdout (pretty in `NODE_ENV=development`), plus OpenTelemetry. They never contain SIGAE bodies, credentials or the proxy URL.
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
