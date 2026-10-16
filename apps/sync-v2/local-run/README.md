# sync-v2 local 24-hour run

The phase 6 run (see [PLAN.md](../PLAN.md)): the built sync-v2 image against live SIGAE, with its own Postgres, Redis and telemetry, in the Docker Compose project `emcr-sync-local`.

| Service    | Image                                                                 | Published on (loopback only)                         |
| ---------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| `postgres` | `postgres:17-alpine`, volume `postgres`                               | `127.0.0.1:25432`, database `emergenciascr_v2_local` |
| `redis`    | `redis:7-alpine`, AOF on, volume `redis`                              | `127.0.0.1:26379`                                    |
| `migrate`  | `apps/migrate/Dockerfile`, one-shot                                   | none                                                 |
| `otel`     | `grafana/otel-lgtm` (Grafana, Prometheus, Tempo, Loki), volume `otel` | Grafana on `http://127.0.0.1:23000` (admin / admin)  |
| `sync-v2`  | `apps/sync-v2/Dockerfile`                                             | none (health check inside the container)             |

sync-v2 starts after `migrate` exits 0, runs with `TZ=UTC` like the servers, and exports traces, metrics and logs to `otel` with `deployment.environment.name=local-24h`. Container logs rotate at 5 × 20 MB per service.

## Secrets

`compose.sh` passes `apps/sync-v2/.env` to Compose with `--env-file`, for interpolation only: `compose.yaml` copies `SIGAE_API_URL`, `SIGAE_IP`, `SIGAE_USER`, `SIGAE_PASSWORD`, `SIGAE_COD_SYS` and the optional `SIGAE_PROXY_URL` into the sync-v2 container. Nothing else from that file reaches a container, so its `DRIZZLE_POSTGRES_URL` and `REDIS_URL` are never used: both point at the compose services. The `.env` file is never copied into an image (`.dockerignore`). Don't run `compose.sh config` without `--quiet`: it prints the interpolated credentials.

## Commands

From the repository root:

```sh
apps/sync-v2/local-run/compose.sh up -d --build      # build and start (or apply changes)
apps/sync-v2/local-run/status.sh                     # read-only summary, see below
apps/sync-v2/local-run/compose.sh logs -f --no-log-prefix sync-v2 | jq -c '{timestamp, level, message, incidentId, result}'
apps/sync-v2/local-run/compose.sh ps --all
apps/sync-v2/local-run/compose.sh stop               # stop, keeping the data
apps/sync-v2/local-run/compose.sh start              # start again after a stop
apps/sync-v2/local-run/redis-reset.sh --yes          # Redis reset check, see below
```

`status.sh` prints the containers and sync-v2's health, `incident_sync_state` by phase, `failed` incidents with their (redacted) `lastError`, overdue polls, the tracking window, row counts (snapshots, changes, anomalies by code, `vehicle_station_history`), BullMQ jobs per queue, disk use and the warn and error log lines of the last hour (`LOG_WINDOW=6h` for more). It only reads, and only prints counts, IDs, codes and times.

In Grafana (Explore): Prometheus metrics such as `sync_poll_results_total`, `sync_incidents`, `sync_queue_jobs`, `sigae_client_requests_total`; Loki logs with `{service_name="sync-v2"}`; Tempo traces for service `sync-v2`.

## Redis reset check

PLAN phase 6: "deleting the Redis data and restarting resumes every tracked incident". `redis-reset.sh --yes` stops sync-v2 (gracefully), runs `FLUSHALL` on the compose Redis only, starts sync-v2, waits for the boot gap fill (up to `WAIT_SECONDS`, 120 by default) and compares the `active` and `settling` incidents in Postgres with the `incident-poll` jobs in Redis. It exits 1 when a tracked incident has no job. Run it once or twice during the 24 hours, ideally while some incidents are `settling`.

## Acceptance (PLAN phase 6)

- [ ] 24 hours without stuck or `failed` incidents (`status.sh`: no `failed` rows, no polls overdue by more than 5 minutes, `consecutiveFailures` back to 0).
- [ ] Queues don't grow: `incident-poll` delayed jobs track the `active` + `settling` count, no waiting backlog, no failed jobs piling up.
- [ ] Incidents move through `active` → `settling` → `done` (`done` grows over the day; nothing stays `active` long after closing).
- [ ] The Redis reset check passes during the run.
- [ ] Spec section 3.3: a brand-new incident with no units yet; check its first snapshots of the units and stations endpoints (`ObtenerUnidadesDespachadasIncidente`, `ObtenerEstacionesAtiendeIncidente`) in `sigae_snapshots` by `codigo` and item count, without reading the payloads' personal fields.
- [ ] sync-v2 restarts stay at 0 (`status.sh`), and warn/error lines are explained.

## Run log

- Stack started 2026-10-16 20:00:21 UTC (14:00:21 Costa Rica).
- sync-v2 redeployed with the incident type refresh fix (commit `share the incident type refresh between concurrent polls`) at 2026-10-16 20:19:07 UTC (14:19:07 Costa Rica). The 24 hours count from here: the run ends 2026-10-17 20:19 UTC (14:19 Costa Rica).
- First 30 minutes: migrate applied 5 migrations; SIGAE ping OK; reference data synced (7 provinces, 84 cantons, 500 districts, 155 stations, 420 vehicles, 599 incident types); 50 incidents tracked (14 `active`, 36 `settling`), every poll `ok` or `partial`, no `failed` incidents, no overdue polls; `vehicle_station_history` had a row for every vehicle; metrics, traces and logs reached Grafana with `service_name=sync-v2`. The first incident discovered after boot was listed at 20:29 UTC, about 83 minutes after its report time and with a lower ID than the newest one tracked (`sync.discovery.delay` shows it); none newer than 19:55 UTC had been listed by then. PLAN phase 6 notes list what was found and fixed.
- The disk holding Docker was 98% used at the start (about 14 GB free). Loki refuses logs at 90% by default, so `compose.yaml` raises its threshold to 95%; `status.sh` shows the free space.

## Teardown

```sh
apps/sync-v2/local-run/compose.sh down       # remove the containers, keep the volumes
apps/sync-v2/local-run/compose.sh down -v    # also DELETES the Postgres, Redis and telemetry data
```

`down -v` deletes the volumes `emcr-sync-local_postgres`, `emcr-sync-local_redis` and `emcr-sync-local_otel` for good, including every snapshot of the run. Capture any fixtures you need first:

```sh
CAPTURE_DATABASE_URL=postgres://sync:sync-local@127.0.0.1:25432/emergenciascr_v2_local \
  bun run --cwd packages/sync-domain capture-fixture --incident <id> --scenario <name>
```
