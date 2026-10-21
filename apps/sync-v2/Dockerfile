FROM oven/bun:1.4.0-alpine AS manifests

WORKDIR /src

COPY . .

# bun only accepts the monorepo lockfile with every workspace manifest present. Copying just
# the manifests keeps the install layers cached until a manifest or bun.lock changes.
RUN mkdir /manifests \
  && cp package.json bun.lock /manifests/ \
  && find apps packages -mindepth 2 -maxdepth 2 -name package.json -exec cp --parents {} /manifests/ \;

FROM oven/bun:1.4.0-alpine AS build

WORKDIR /app

COPY --from=manifests /manifests ./

RUN bun install --frozen-lockfile --ignore-scripts --filter sync-v2

COPY packages/typescript-config ./packages/typescript-config
COPY packages/db/src ./packages/db/src
COPY packages/lib/src ./packages/lib/src
COPY packages/sigae/src ./packages/sigae/src
COPY packages/sync-domain/src ./packages/sync-domain/src
COPY apps/sync-v2/tsconfig.json apps/sync-v2/tsdown.config.ts ./apps/sync-v2/
COPY apps/sync-v2/src ./apps/sync-v2/src

# tsdown bundles the workspace packages and every dependency sync-v2 doesn't declare itself
# (drizzle-orm, pg, undici), so the runtime only needs sync-v2's own dependencies.
RUN bun run --cwd apps/sync-v2 build

FROM oven/bun:1.4.0-alpine AS deps

WORKDIR /app

COPY --from=manifests /manifests ./

RUN bun install --frozen-lockfile --production --ignore-scripts --filter sync-v2

FROM oven/bun:1.4.0-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HEALTH_PORT=8080

# The isolated linker uses relative symlinks, so the store and each workspace's node_modules
# must keep their paths. The workspace packages are bundled; only their manifests and links
# are copied so sync-v2's node_modules has no dangling links.
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/db ./packages/db
COPY --from=deps /app/packages/lib ./packages/lib
COPY --from=deps /app/packages/sigae ./packages/sigae
COPY --from=deps /app/packages/sync-domain ./packages/sync-domain
COPY --from=deps /app/apps/sync-v2 ./apps/sync-v2
COPY --from=build /app/apps/sync-v2/dist ./apps/sync-v2/dist

WORKDIR /app/apps/sync-v2

RUN bun -e 'for (const name of ["bullmq", "bullmq-otel", "ioredis", "winston", "@opentelemetry/sdk-node", "@opentelemetry/winston-transport"]) await import(name); console.log("sync-v2 deps ok")' \
  && test ! -e .env

USER bun

# The health server stays on loopback (HEALTH_HOST): the check runs inside the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${HEALTH_PORT}/health" || exit 1

# The shutdown waits up to 30 s for running jobs and exits by 45 s: give the container
# runtime a longer stop timeout than that (for example `stop_grace_period: 60s`).
STOPSIGNAL SIGTERM

CMD ["bun", "run", "--no-install", "dist/index.mjs"]
