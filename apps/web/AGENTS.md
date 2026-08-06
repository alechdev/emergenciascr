# apps/web

- `api/`: Hono OpenAPI HTTP API (external consumers). Feature routers in `api/routers`, schemas in `api/schemas`, DB queries in `packages/db/src/queries`.
- `src/`: TanStack Start app (UI routes, components; future server functions live here).
- Schema exports use lowerCamelCase; list endpoints follow the incidents pattern with `*ListRequest`/`*ListResponse` and `{ meta, data }` payloads.
- List sorting uses a two-item array `[field, direction]` in query params.
- For boolean query params, prefer `stringBoolean` from `@api/lib/zod-utils` so `true`/`false` strings parse correctly.
- Treat generated files like `src/lib/api/*.gen.ts` and `src/routeTree.gen.ts` as generated artifacts (do not edit manually).
- Prod entry `server.ts` mounts Hono at `/api/*` and Start for everything else.
- Dev: TanStack Start routes `src/routes/api/` forward `/api` to the same Hono app (same origin/port as the UI).
