import { createFileRoute } from "@tanstack/react-router";

import { proxyInternalSitemap } from "@/lib/sitemap-proxy";

export const Route = createFileRoute("/sitemap-stations.xml")({
  server: {
    handlers: {
      GET: async () => proxyInternalSitemap("stations.xml")
    }
  }
});
