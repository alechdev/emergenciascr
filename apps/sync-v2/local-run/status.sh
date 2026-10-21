#!/usr/bin/env bash
# Read-only status of the local sync-v2 run: containers, sync state, queues, stored rows and
# recent warnings. Only counts, IDs, codes and times: no SIGAE payloads or personal data.
#
#   apps/sync-v2/local-run/status.sh
#   LOG_WINDOW=6h apps/sync-v2/local-run/status.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose() { "$here/compose.sh" "$@"; }
log_window="${LOG_WINDOW:-1h}"

sql() {
  compose exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres \
    psql -U sync -d emergenciascr_v2_local -X -q -P pager=off -v ON_ERROR_STOP=1 "$@"
}
redis_cli() { compose exec -T redis redis-cli "$@" | tr -d '\r'; }

section() { printf '\n== %s\n' "$1"; }

section "now"
echo "UTC          $(date -u '+%Y-%m-%d %H:%M:%S')"
echo "Costa Rica   $(TZ=America/Costa_Rica date '+%Y-%m-%d %H:%M:%S')"

section "containers"
compose ps --all --format '{{.Service}}|{{.Status}}' | while IFS='|' read -r service status; do
  printf '%-10s %s\n' "$service" "$status"
done
echo "sync-v2 restarts: $(docker inspect -f '{{.RestartCount}}' "$(compose ps -q sync-v2)")"

section "sync-v2 health"
compose exec -T sync-v2 sh -c 'wget -q -O - "http://127.0.0.1:${HEALTH_PORT}/health"' ||
  echo "(health check failed)"
echo

section "incident_sync_state by phase"
sql -c 'select phase, count(*) as incidents from incident_sync_state group by phase order by phase'

section "failed incidents (lastError truncated)"
sql -c 'select "incidentId", "consecutiveFailures", "lastPolledAt", left("lastError", 160) as "lastError"
  from incident_sync_state where phase = '"'failed'"' order by "lastPolledAt" desc nulls last limit 20'

section "active/settling incidents with failures or overdue polls"
sql -c 'select
    count(*) filter (where "nextPollAt" < now() - interval '"'5 minutes'"') as "overdue > 5 min",
    count(*) filter (where "nextPollAt" is null) as "no nextPollAt",
    count(*) filter (where "consecutiveFailures" > 0) as "failing now",
    max("consecutiveFailures") as "max consecutiveFailures",
    min("nextPollAt") as "earliest nextPollAt"
  from incident_sync_state where phase in ('"'active'"', '"'settling'"')'

section "recent failing polls (lastError truncated)"
sql -c 'select "incidentId", phase, "consecutiveFailures", left("lastError", 160) as "lastError"
  from incident_sync_state where "consecutiveFailures" > 0 and phase in ('"'active'"', '"'settling'"')
  order by "consecutiveFailures" desc limit 10'

section "tracking window"
sql -c 'select count(*) as tracked, min("firstSeenAt") as "oldest firstSeenAt",
    max("firstSeenAt") as "newest firstSeenAt", max("lastPolledAt") as "latest poll"
  from incident_sync_state'

section "stored rows"
sql -c 'select
    (select count(*) from incidents) as incidents,
    (select count(*) from sigae_snapshots) as snapshots,
    (select count(*) from incident_changes) as changes,
    (select count(*) from sync_anomalies) as anomalies,
    (select count(*) from dispatched_vehicles) as "dispatched vehicles",
    (select count(*) from dispatched_stations) as "dispatched stations"'
sql -c 'select
    (select count(*) from stations) as stations,
    (select count(*) from vehicles) as vehicles,
    (select count(*) from vehicle_station_history) as "vehicle station history",
    (select count(*) from incident_types) as "incident types",
    (select count(*) from provinces) as provinces,
    (select count(*) from cantons) as cantons,
    (select count(*) from districts) as districts'

section "snapshots by endpoint and codigo"
sql -c 'select endpoint, coalesce(codigo, '"'-'"') as codigo, count(*) as snapshots
  from sigae_snapshots group by 1, 2 order by 1, 2'

section "anomalies by code (top 10)"
sql -c 'select code, count(*) as anomalies, count(distinct "incidentId") as incidents,
    max("detectedAt") as latest from sync_anomalies group by code order by 2 desc limit 10'

section "changes by entity and kind"
sql -c 'select entity, kind, count(*) as changes from incident_changes group by 1, 2 order by 3 desc'

section "BullMQ jobs per queue"
printf '%-20s %8s %8s %8s %8s %10s %8s\n' queue waiting active delayed failed completed prio
for queue in reference stations vehicles incident-discovery incident-poll; do
  prefix="bull:$queue"
  waiting=$(redis_cli llen "$prefix:wait")
  active=$(redis_cli llen "$prefix:active")
  delayed=$(redis_cli zcard "$prefix:delayed")
  failed=$(redis_cli zcard "$prefix:failed")
  completed=$(redis_cli zcard "$prefix:completed")
  prioritized=$(redis_cli zcard "$prefix:prioritized")
  printf '%-20s %8s %8s %8s %8s %10s %8s\n' "$queue" "$waiting" "$active" "$delayed" \
    "$failed" "$completed" "$prioritized"
done
echo "redis memory: $(redis_cli info memory | tr -d '\r' | sed -n 's/^used_memory_human://p')"

section "disk"
sql -At -c 'select '"'postgres database: '"' || pg_size_pretty(pg_database_size(current_database()))'
# DockerRootDir is a path on the daemon's host: not this one with Docker Desktop or a remote context.
docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
if [ -n "$docker_root" ] && [ -d "$docker_root" ]; then
  df -h "$docker_root" | tail -n 1 |
    awk '{print "docker disk: " $4 " free of " $2 " (" $5 " used)"}'
else
  echo "docker disk: unavailable (the Docker data directory isn't on this host)"
fi

section "sync-v2 log levels (last $log_window)"
compose logs --no-log-prefix --since "$log_window" sync-v2 2>/dev/null |
  sed -n 's/.*"level":"\([a-z]*\)".*/\1/p' | sort | uniq -c | sort -rn || true

section "sync-v2 warn/error messages (last $log_window, by message)"
compose logs --no-log-prefix --since "$log_window" sync-v2 2>/dev/null |
  grep -E '"level":"(warn|error)"' |
  sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | sort | uniq -c | sort -rn | head -15 || true
