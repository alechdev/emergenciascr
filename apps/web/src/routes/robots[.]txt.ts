import { isBetaSite } from "@bomberoscr/lib/site-env";
import { createFileRoute } from "@tanstack/react-router";

const MAIN_ROBOTS_TXT = `User-agent: *
Allow: /

Sitemap: https://emergenciascr.com/sitemap.xml
`;

const BETA_ROBOTS_TXT = `User-agent: *
Disallow: /
`;

// A route rather than `public/robots.txt`: the production server serves static files before
// Start, so a static file would be the same on both sites.
function robotsResponse(includeBody: boolean) {
  const body = isBetaSite() ? BETA_ROBOTS_TXT : MAIN_ROBOTS_TXT;

  return new Response(includeBody ? body : null, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => robotsResponse(true),
      HEAD: () => robotsResponse(false)
    }
  }
});
