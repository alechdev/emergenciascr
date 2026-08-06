import { createFileRoute } from "@tanstack/react-router";

import { proxyInternalSitemap } from "@/lib/sitemap-proxy";

export const Route = createFileRoute("/sitemap-pages.xml")({
  server: {
    handlers: {
      GET: async () => proxyInternalSitemap("pages.xml")
    }
  }
});
