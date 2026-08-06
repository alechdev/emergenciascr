import { createFileRoute } from "@tanstack/react-router";

async function serve({ request }: { request: Request }) {
  const { default: app } = await import("../../../api/app");
  return app.fetch(request);
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: serve,
      POST: serve,
      PUT: serve,
      PATCH: serve,
      DELETE: serve,
      OPTIONS: serve,
      HEAD: serve
    }
  }
});
