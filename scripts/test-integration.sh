#!/usr/bin/env bash
# Runs the sync integration tests (packages/sync-domain, apps/sync-v2) against a throwaway
# Postgres and Redis, under TZ=UTC and TZ=America/Costa_Rica. Both servers run in Docker on
# random loopback ports and are removed on exit, whatever happens. Nothing here reads
# DRIZZLE_POSTGRES_URL or REDIS_URL: the tests only get TEST_DATABASE_URL and TEST_REDIS_URL.
#
#   scripts/test-integration.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
name="emcr-integration-$$"
pg="${name}-pg"
redis="${name}-redis"

cleanup() {
  docker rm -f "$pg" "$redis" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run -d --rm --name "$pg" -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=sync_test \
  postgres:17-alpine >/dev/null
docker run -d --rm --name "$redis" -p 127.0.0.1::6379 redis:7-alpine >/dev/null

port() {
  docker port "$1" "$2" | head -n 1 | sed 's/.*://'
}

for _ in $(seq 1 60); do
  if docker exec "$pg" pg_isready -U test -d sync_test -h 127.0.0.1 >/dev/null 2>&1 &&
    [ "$(docker exec "$redis" redis-cli ping 2>/dev/null)" = "PONG" ]; then
    break
  fi
  sleep 0.5
done
docker exec "$pg" pg_isready -U test -d sync_test -h 127.0.0.1 >/dev/null

export TEST_DATABASE_URL="postgres://test:test@127.0.0.1:$(port "$pg" 5432)/sync_test"
# The harness refuses Redis database 0 and database names without "test".
export TEST_REDIS_URL="redis://127.0.0.1:$(port "$redis" 6379)/15"

for tz in UTC America/Costa_Rica; do
  echo "== TZ=$tz"
  TZ="$tz" bun run --cwd "$root/packages/sync-domain" test:integration
  TZ="$tz" bun run --cwd "$root/apps/sync-v2" test:integration
done
