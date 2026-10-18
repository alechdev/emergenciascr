import { betaRobots } from "@api/middlewares/beta-robots";
import { rootRouteId } from "@tanstack/react-router";
import { Hono } from "hono";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BetaBanner } from "@/components/layout/beta-banner";
import { Route as RootRoute } from "@/routes/__root";
import { Route as IncidentRoute } from "@/routes/_dashboard/incidentes/$slug";
import { Route as RobotsRoute } from "@/routes/robots[.]txt";
import { Route as SitemapIncidentsMonthRoute } from "@/routes/sitemap-incidents-{$yearMonth}[.]xml";
import { Route as SitemapIncidentsRoute } from "@/routes/sitemap-incidents[.]xml";
import { Route as SitemapPagesRoute } from "@/routes/sitemap-pages[.]xml";
import { Route as SitemapStationsRoute } from "@/routes/sitemap-stations[.]xml";
import { Route as SitemapRoute } from "@/routes/sitemap[.]xml";
import { betaRobotsMiddleware } from "@/server/beta-robots-middleware";
import { readSiteEnv } from "@/server/site-env";

// Nothing here may reach a configured database, even through an import.
vi.hoisted(() => {
  process.env.DRIZZLE_POSTGRES_URL = "postgres://none@127.0.0.1:9/none";
});
vi.mock("@/server/incidents/get-incident-page", () => ({ getIncidentPage: vi.fn() }));

const NOINDEX = "noindex, nofollow";
const UMAMI_SRC = "https://u.alech.dev/script.js";

type Meta = { name?: string; content?: string };
type Head = { meta?: Meta[]; scripts?: Array<{ src?: string }> };
type HeadFn = (context: unknown) => Head;
type Handler = (context: { params: Record<string, string> }) => Promise<Response> | Response;

function handler(route: { options: { server?: unknown } }, method: "GET" | "HEAD"): Handler {
  const server = route.options.server as { handlers: Record<string, Handler> };
  return server.handlers[method];
}

function metaContent(head: Head, name: string): string | undefined {
  return head.meta?.find((meta) => meta.name === name)?.content;
}

function rootHead(beta: boolean): Head {
  const head = RootRoute.options.head as unknown as HeadFn;
  return head({ loaderData: { beta }, matches: [], params: {} });
}

function rootMatch(beta: boolean) {
  return { routeId: rootRouteId, loaderData: { beta } };
}

function incidentHead(beta: boolean): Head {
  const head = IncidentRoute.options.head as unknown as HeadFn;
  return head({
    loaderData: {
      incident: {
        id: 1,
        slug: "1-incendio-estructural-2026-01-01",
        title: "INCENDIO ESTRUCTURAL",
        EEConsecutive: "26-000001",
        // Open, so the main site indexes it whatever the date.
        isOpen: true,
        incidentTimestamp: "2026-01-01T12:00:00.000Z",
        address: null
      },
      stations: [{ vehicles: [{}] }],
      timeline: [],
      responseTimes: []
    },
    matches: [rootMatch(beta)],
    params: {}
  });
}

async function apiResponse(): Promise<Response> {
  const app = new Hono().use(betaRobots());
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  return app.request("/api/health");
}

async function startResponse(response: Response): Promise<Response> {
  type Server = (options: {
    next: () => Promise<{ response: Response }>;
  }) => Promise<{ response: Response }>;
  const server = betaRobotsMiddleware.options.server as unknown as Server;
  const result = await server({ next: () => Promise.resolve({ response }) });
  return result.response;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the beta site (SITE_ENV=beta)", () => {
  function beta() {
    vi.stubEnv("SITE_ENV", "beta");
  }

  it("sends X-Robots-Tag noindex on API responses", async () => {
    beta();
    const response = await apiResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe(NOINDEX);
  });

  it("sends X-Robots-Tag noindex on Start responses, even ones with immutable headers", async () => {
    beta();
    const page = await startResponse(new Response("<html></html>"));
    expect(page.headers.get("x-robots-tag")).toBe(NOINDEX);

    const redirect = await startResponse(Response.redirect("http://localhost/incidentes", 301));
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe("http://localhost/incidentes");
    expect(redirect.headers.get("x-robots-tag")).toBe(NOINDEX);
  });

  it("disallows everything in robots.txt, with no sitemap", async () => {
    beta();
    const response = await handler(RobotsRoute, "GET")({ params: {} });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("serves no sitemap", async () => {
    beta();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const responses = await Promise.all([
      handler(SitemapRoute, "GET")({ params: {} }),
      handler(SitemapPagesRoute, "GET")({ params: {} }),
      handler(SitemapStationsRoute, "GET")({ params: {} }),
      handler(SitemapIncidentsRoute, "GET")({ params: {} }),
      handler(SitemapIncidentsMonthRoute, "GET")({ params: { yearMonth: "2026-01" } })
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is what the root route loads for the page", () => {
    beta();
    expect(readSiteEnv()).toEqual({ beta: true });
  });

  it("marks every page noindex and loads no analytics", () => {
    beta();
    vi.stubEnv("PROD", true);
    const head = rootHead(true);
    expect(metaContent(head, "robots")).toBe(NOINDEX);
    expect(metaContent(head, "googlebot")).toBe(NOINDEX);
    expect(head.scripts).toEqual([]);
  });

  it("keeps incident pages noindex, whose robots meta overrides the root's", () => {
    const head = incidentHead(true);
    expect(metaContent(head, "robots")).toBe(NOINDEX);
    expect(metaContent(head, "googlebot")).toBe(NOINDEX);
  });

  it("shows a banner saying the data comes from sync-v2", () => {
    const html = renderToStaticMarkup(<BetaBanner />);
    expect(html).toContain('role="status"');
    expect(html).toContain("datos de sync-v2");
  });
});

describe("the main site (SITE_ENV unset or anything but beta)", () => {
  it.each([undefined, "", "production", "BETA", "beta "])(
    "sends no X-Robots-Tag with SITE_ENV=%j",
    async (siteEnv) => {
      vi.stubEnv("SITE_ENV", siteEnv);
      expect(readSiteEnv()).toEqual({ beta: false });
      expect((await apiResponse()).headers.get("x-robots-tag")).toBeNull();
      expect((await startResponse(new Response("ok"))).headers.get("x-robots-tag")).toBeNull();
    }
  );

  it("allows everything in robots.txt and points to the sitemap", async () => {
    vi.stubEnv("SITE_ENV", undefined);
    const response = await handler(RobotsRoute, "GET")({ params: {} });
    expect(await response.text()).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://emergenciascr.com/sitemap.xml\n"
    );

    const head = await handler(RobotsRoute, "HEAD")({ params: {} });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("serves the sitemap from the internal API", async () => {
    vi.stubEnv("SITE_ENV", undefined);
    vi.stubEnv("VITE_SERVER_URL", "https://site.test/api");
    vi.stubEnv("SITEMAP_TOKEN", "test-token");
    const fetchMock = vi.fn(
      async () =>
        new Response("<sitemapindex/>", {
          headers: { "Content-Type": "application/xml; charset=utf-8" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(SitemapRoute, "GET")({ params: {} });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<sitemapindex/>");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://site.test/api/sitemap/internal/index.xml?token=test-token",
      expect.anything()
    );
  });

  it("keeps the robots meta and loads analytics in production builds", () => {
    vi.stubEnv("PROD", true);
    const head = rootHead(false);
    expect(metaContent(head, "robots")).toBe("index, follow");
    expect(head.scripts?.map((script) => script.src)).toEqual([UMAMI_SRC]);
  });

  it("keeps the incident page's own robots meta", () => {
    expect(metaContent(incidentHead(false), "robots")).toBe("index, follow");
  });
});
