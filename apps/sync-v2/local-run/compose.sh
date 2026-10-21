#!/usr/bin/env bash
# docker compose for the local sync-v2 run. apps/sync-v2/.env is only used for interpolation:
# compose.yaml picks the SIGAE_* variables from it and never loads the file into a container,
# so its DRIZZLE_POSTGRES_URL and REDIS_URL (which may point at production) are never used.
#
#   apps/sync-v2/local-run/compose.sh up -d --build
#   apps/sync-v2/local-run/compose.sh logs -f sync-v2
#
# Don't run `config` without `--quiet`: it prints the interpolated SIGAE credentials.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${SYNC_V2_ENV_FILE:-$here/../.env}"

if [ ! -f "$env_file" ]; then
  echo "missing $env_file (copy apps/sync-v2/.env.example and fill in the SIGAE values)" >&2
  exit 1
fi

exec docker compose --project-directory "$here" -f "$here/compose.yaml" --env-file "$env_file" "$@"
