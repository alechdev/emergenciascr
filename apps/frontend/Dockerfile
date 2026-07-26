FROM oven/bun:1.3.9-alpine AS build

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
RUN bun run --filter frontend build

# Build a minimal package.json with only runtime dependencies (no devDependencies).
# Workspace packages (@bomberoscr/*) are bundled into the Vite SSR build, same as the API image.
RUN apk add --no-cache jq && \
  jq 'del(.devDependencies) | .dependencies |= with_entries(select(
    (.key | test("@tanstack/react-(devtools|query-devtools|router-devtools|start)") | not)
    and (.key | startswith("@bomberoscr/") | not)
  ))' \
  apps/frontend/package.json > /tmp/package.json
FROM oven/bun:1.3.9-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /tmp/package.json ./package.json
COPY --from=build /app/apps/frontend/dist ./dist
COPY --from=build /app/apps/frontend/server.ts ./server.ts

RUN bun install --production --ignore-scripts

USER bun

EXPOSE 3000

CMD ["bun", "run", "--no-install", "server.ts"]
