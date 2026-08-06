# Repository Guidelines

## Project Structure & Module Organization

This repository is a Bun workspace monorepo:

- `apps/web`: TanStack Start app (`src/`) + Hono OpenAPI API (`api/`) served together in production.
- `apps/sync-v2`: BullMQ-based sync workers and queues.
- `apps/sync`: legacy sync service.
- `packages/*`: shared modules (`db`, `lib`, `sync-domain`, `sigae`, `typescript-config`).

Keep API feature logic close to its boundary (`api/` route + schema + DB query). In the Start app, treat generated files like `src/lib/api/*.gen.ts` and `src/routeTree.gen.ts` as generated artifacts (do not edit manually).

## Build, Test, and Development Commands

- `bun install`: install all workspace dependencies.
- `bun run dev`: run web (Start + Hono API on one port via Vite).
- `bun run dev:all`: run web + `sync-v2`.
- `bun run dev:web` / `bun run dev:sync`: run one process.
- `bun run lint:check`: run lint checks for web.
- `bun run format:check`: verify formatting for web.
- `bun run --cwd apps/web test`: run web tests (Vitest).
- `bun run --cwd apps/sync-v2 test`: run sync-v2 tests (Vitest).
- Optional: `bun run --cwd apps/web dev:api` runs Hono alone (standalone) for debugging.
  For DB tasks, use `packages/db` scripts (example: `bun run --cwd packages/db drizzle:generate`).

## Coding Style & Naming Conventions

TypeScript with strict settings is standard across apps/packages. Formatting is enforced with `oxfmt` (2 spaces, semicolons, double quotes, max width 100). Linting uses `oxlint`.

Use `@/*` for Start app imports (`src/`) and `@api/*` for Hono API imports (`api/`). Prefer kebab-case file names (`incident-types.ts`), and follow existing router naming conventions (`__root.tsx`, `$slug.tsx`).
