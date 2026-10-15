FROM oven/bun:1.4.0-alpine AS manifests

WORKDIR /src

COPY . .

# bun only accepts the monorepo lockfile with every workspace manifest present. Copying just
# the manifests keeps the install layer cached until a manifest or bun.lock changes.
RUN mkdir /manifests \
  && cp package.json bun.lock /manifests/ \
  && find apps packages -mindepth 2 -maxdepth 2 -name package.json -exec cp --parents {} /manifests/ \;

FROM oven/bun:1.4.0-alpine AS deps

WORKDIR /app

COPY --from=manifests /manifests ./

RUN bun install --frozen-lockfile --production --ignore-scripts --filter migrate

FROM oven/bun:1.4.0-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# The isolated linker uses relative symlinks, so the store and each workspace's node_modules
# must keep their paths. packages/lib is linked by packages/db but never imported by the
# migration runner, so only its manifest is needed.
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/lib ./packages/lib
COPY --from=deps /app/packages/db ./packages/db
COPY --from=deps /app/apps/migrate ./apps/migrate
COPY packages/db/src ./packages/db/src
COPY packages/db/drizzle ./packages/db/drizzle
COPY apps/migrate/src ./apps/migrate/src

RUN bun --cwd apps/migrate -e 'import "@bomberoscr/db/migrate"; console.log("migrate deps ok")'

WORKDIR /app/apps/migrate

USER bun

CMD ["bun", "run", "--no-install", "src/index.ts"]
