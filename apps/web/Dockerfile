FROM oven/bun:1.3.14-alpine AS build

WORKDIR /app

ARG VITE_BASE=/
ARG VITE_MAPBOX_TOKEN
ARG VITE_SERVER_URL
ARG VITE_SITE_URL
ENV VITE_BASE=${VITE_BASE}
ENV VITE_MAPBOX_TOKEN=${VITE_MAPBOX_TOKEN}
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV VITE_SITE_URL=${VITE_SITE_URL}

COPY . .

RUN bun install --frozen-lockfile
RUN bun run --filter web build

# Minimal workspace manifest for the runtime image (web + packages the API imports).
# Strip devDependencies so bun does not require build-only workspace packages
# like @bomberoscr/typescript-config during the production install.
RUN apk add --no-cache jq && \
  printf '%s\n' \
  '{' \
  '  "private": true,' \
  '  "workspaces": ["apps/web", "packages/db", "packages/lib", "packages/sync-domain"],' \
  '  "packageManager": "bun@1.3.14"' \
  '}' > /tmp/root.package.json \
  && jq 'del(.devDependencies)' apps/web/package.json > /tmp/web.package.json \
  && jq 'del(.devDependencies)' packages/db/package.json > /tmp/db.package.json \
  && jq 'del(.devDependencies)' packages/lib/package.json > /tmp/lib.package.json \
  && jq 'del(.devDependencies)' packages/sync-domain/package.json > /tmp/sync-domain.package.json

FROM oven/bun:1.3.14-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /tmp/root.package.json ./package.json
COPY --from=build /tmp/web.package.json ./apps/web/package.json
COPY --from=build /tmp/db.package.json ./packages/db/package.json
COPY --from=build /tmp/lib.package.json ./packages/lib/package.json
COPY --from=build /tmp/sync-domain.package.json ./packages/sync-domain/package.json

RUN bun install --production --ignore-scripts

COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/server.ts ./apps/web/server.ts
COPY --from=build /app/apps/web/api ./apps/web/api
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY --from=build /app/packages/db ./packages/db
COPY --from=build /app/packages/lib ./packages/lib
COPY --from=build /app/packages/sync-domain ./packages/sync-domain

WORKDIR /app/apps/web

USER bun

EXPOSE 3000

CMD ["bun", "run", "--no-install", "server.ts"]
