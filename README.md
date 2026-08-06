<p align="center">
  <img src=".github/assets/social-preview.png" alt="Emergencias CR" width="100%" />
</p>

Emergencias CR brings together real-time details, analysis, and statistics about emergencies attended by Bomberos de Costa Rica.

<p align="center">
  <a href="https://emergencias.alech.dev">Live site</a>
  ·
  <a href="https://emergencias.alech.dev/api">API reference</a>
</p>

## Screenshots

<p align="center">
  <img src=".github/assets/desktop_homepage2.png" alt="Desktop homepage" width="100%" />
</p>

<p align="center">
  <img src=".github/assets/desktop_map.png" alt="Desktop map view" width="49%" />
  <img src=".github/assets/desktop_station.png" alt="Desktop station view" width="49%" />
</p>

<p align="center">
  <img src=".github/assets/mobile_homepage.png" alt="Mobile homepage" width="32%" />
  <img src=".github/assets/mobile_map.png" alt="Mobile map view" width="32%" />
  <img src=".github/assets/mobile_station.png" alt="Mobile station view" width="32%" />
</p>

## What's Included

- `apps/web`: TanStack Start app + Hono OpenAPI API (one deployable unit).
- `apps/sync-v2`: BullMQ-based sync service.
- `apps/sync`: legacy sync service.
- `packages/*`: shared modules for DB, libraries, and domain logic.

## Development

Install dependencies:

```bash
bun install
```

Run the web app (Start + API on `:3000`):

```bash
bun dev
```

Run everything, including sync:

```bash
bun dev:all
```

Run individual processes:

```bash
bun dev:web
bun dev:sync
```

## Verification

Lint:

```bash
bun lint:check
```

Formatting:

```bash
bun format:check
```
