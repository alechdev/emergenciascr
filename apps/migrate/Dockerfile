FROM oven/bun:1.4.0-alpine AS manifests

WORKDIR /app

COPY apps/migrate/package.json apps/migrate/package.json
COPY packages/db/package.json packages/db/package.json

# Slim workspace with only the migrate app and packages/db. devDependencies are stripped so
# bun does not need build-only workspace packages, and @bomberoscr/lib is dropped because
# only the db query modules use it, never the migration runner.
RUN apk add --no-cache jq && \
  printf '%s\n' \
  '{' \
  '  "private": true,' \
  '  "workspaces": ["apps/migrate", "packages/db"],' \
  '  "packageManager": "bun@1.4.0"' \
  '}' > /tmp/root.package.json \
  && jq 'del(.devDependencies)' apps/migrate/package.json > /tmp/migrate.package.json \
  && jq 'del(.devDependencies) | del(.dependencies["@bomberoscr/lib"])' packages/db/package.json \
  > /tmp/db.package.json

FROM oven/bun:1.4.0-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# No bun.lock: the slim workspace does not match the monorepo lockfile.
COPY --from=manifests /tmp/root.package.json ./package.json
COPY --from=manifests /tmp/migrate.package.json ./apps/migrate/package.json
COPY --from=manifests /tmp/db.package.json ./packages/db/package.json

# Sources go in before install so bun's workspace links land correctly.
COPY packages/db/src ./packages/db/src
COPY packages/db/drizzle ./packages/db/drizzle
COPY apps/migrate/src ./apps/migrate/src

RUN bun install --production --ignore-scripts \
  && bun --cwd apps/migrate -e 'import "@bomberoscr/db/migrate"; console.log("migrate deps ok")'

WORKDIR /app/apps/migrate

USER bun

CMD ["bun", "run", "--no-install", "src/index.ts"]
