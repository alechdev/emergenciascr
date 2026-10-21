#!/usr/bin/env bash
# PLAN phase 6 check: deleting the Redis data and restarting resumes every tracked incident.
# Stops sync-v2, flushes the compose Redis (only that one, through `compose exec`), starts
# sync-v2 again and compares the `active`/`settling` incidents in Postgres with the
# `incident-poll` jobs in Redis.
#
#   apps/sync-v2/local-run/redis-reset.sh --yes
#   WAIT_SECONDS=180 apps/sync-v2/local-run/redis-reset.sh --yes
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose() { "$here/compose.sh" "$@"; }
wait_seconds="${WAIT_SECONDS:-120}"

if [ "${1:-}" != "--yes" ]; then
  echo "This deletes every key in the emcr-sync-local Redis. Run again with --yes." >&2
  exit 2
fi

sql() {
  compose exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres \
    psql -U sync -d emergenciascr_v2_local -X -q -At -v ON_ERROR_STOP=1 -c "$1"
}
redis_cli() { compose exec -T redis redis-cli "$@"; }

tracked_ids() {
  sql "select \"incidentId\" from incident_sync_state where phase in ('active', 'settling') order by 1"
}

poll_job_ids() {
  {
    redis_cli zrange bull:incident-poll:delayed 0 -1
    redis_cli lrange bull:incident-poll:wait 0 -1
    redis_cli lrange bull:incident-poll:active 0 -1
    redis_cli zrange bull:incident-poll:prioritized 0 -1
  } | tr -d '\r' | sed -n 's/^incident-poll-\([0-9][0-9]*\)$/\1/p' | sort -n | uniq
}

echo "before: $(tracked_ids | wc -l) active/settling incidents, $(poll_job_ids | wc -l) poll jobs"

echo "stopping sync-v2 (graceful, up to 60 s)"
compose stop sync-v2

echo "flushing the compose Redis"
redis_cli flushall
echo "keys left: $(redis_cli dbsize | tr -d '\r')"

echo "starting sync-v2"
compose start sync-v2
started=$(date +%s)

# Boot runs the gap fill, which reschedules every active and settling incident first.
while :; do
  missing=$(comm -23 <(tracked_ids | sort) <(poll_job_ids | sort) | wc -l)
  elapsed=$(($(date +%s) - started))
  if [ "$missing" -eq 0 ] && [ "$elapsed" -ge 30 ]; then break; fi
  if [ "$elapsed" -ge "$wait_seconds" ]; then break; fi
  sleep 5
done

tracked=$(tracked_ids | sort)
jobs=$(poll_job_ids | sort)
missing_ids=$(comm -23 <(printf '%s\n' "$tracked" | sed '/^$/d') <(printf '%s\n' "$jobs" | sed '/^$/d'))
extra_ids=$(comm -13 <(printf '%s\n' "$tracked" | sed '/^$/d') <(printf '%s\n' "$jobs" | sed '/^$/d'))

# An incident that finished between the two reads above still reads as tracked but has no job
# left, so only the ones still missing a moment later count.
if [ -n "$missing_ids" ]; then
  sleep 5
  # Read both lists outside process substitution so set -e catches a failed read.
  tracked_now=$(tracked_ids | sort)
  jobs_now=$(poll_job_ids | sort)
  missing_ids=$(comm -12 <(printf '%s\n' "$missing_ids") \
    <(comm -23 <(printf '%s\n' "$tracked_now" | sed '/^$/d') <(printf '%s\n' "$jobs_now" | sed '/^$/d')))
fi

echo "after $(($(date +%s) - started)) s:"
echo "  active/settling incidents: $(printf '%s\n' "$tracked" | sed '/^$/d' | wc -l)"
echo "  incident-poll jobs:        $(printf '%s\n' "$jobs" | sed '/^$/d' | wc -l)"
echo "  tracked without a job:     $(printf '%s\n' "$missing_ids" | sed '/^$/d' | wc -l)"
echo "  jobs not active/settling:  $(printf '%s\n' "$extra_ids" | sed '/^$/d' | wc -l)" \
  "(a poll that just finished an incident can show here briefly)"
compose ps sync-v2 --format '  sync-v2: {{.State}} {{.Health}}'

if [ -n "$(printf '%s' "$missing_ids")" ]; then
  echo "FAIL: incidents without a poll job: $(printf '%s ' $missing_ids)"
  exit 1
fi
echo "OK: every active and settling incident has its poll job back"
