import { createFileRoute } from "@tanstack/react-router";

import { proxyInternalSitemap } from "@/lib/sitemap-proxy";

export const Route = createFileRoute("/sitemap-incidents-{$yearMonth}.xml")({
  server: {
    handlers: {
      GET: async ({ params }) => proxyInternalSitemap(`incidents/${params.yearMonth}`)
    }
  }
});
