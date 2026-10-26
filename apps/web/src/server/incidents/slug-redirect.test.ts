import { buildIncidentSlug } from "@api/lib/slug";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Route } from "@/routes/_dashboard/incidentes/$slug";
import { getIncidentPage } from "@/server/incidents/get-incident-page";

import type { IncidentPageData } from "@/server/incidents/get-incident-page";

// Nothing here may reach a configured database, even through an import.
vi.hoisted(() => {
  process.env.DRIZZLE_POSTGRES_URL = "postgres://none@127.0.0.1:9/none";
});
vi.mock("@/server/incidents/get-incident-page", () => ({ getIncidentPage: vi.fn() }));

// Incident 1923918 was reported at 20:25 on 10 October in Costa Rica: the 11th in UTC.
const ID = 1923918;
const REPORTED_AT = new Date("2026-10-11T02:25:19.000Z");
const TITLE = "INCENDIO ESTRUCTURAL";
const UTC_DATE_SLUG = `${ID}-incendio-estructural-2026-10-11`;

function page(): IncidentPageData {
  return {
    incident: { slug: buildIncidentSlug(ID, TITLE, REPORTED_AT) },
    stations: [],
    timeline: [],
    responseTimes: []
  } as unknown as IncidentPageData;
}

type Loader = (context: { params: { slug: string } }) => Promise<unknown>;
type MarkdownHandler = (context: {
  request: Request;
  params: { slug: string };
  next: () => Promise<Response>;
}) => Promise<Response>;

const loader = Route.options.loader as unknown as Loader;
const handlers = Route.options.server?.handlers as unknown as { GET: MarkdownHandler };

beforeEach(() => {
  vi.mocked(getIncidentPage).mockResolvedValue(page());
});

describe("incident slugs", () => {
  it("end with the Costa Rica date the incident was reported", () => {
    expect(buildIncidentSlug(ID, TITLE, REPORTED_AT)).toBe(`${ID}-incendio-estructural-2026-10-10`);
    expect(buildIncidentSlug(ID, null, REPORTED_AT)).toBe(`${ID}-incidente-2026-10-10`);
  });

  it("redirect the old UTC-date slug to the Costa Rica one with a 301", async () => {
    const thrown = await loader({ params: { slug: UTC_DATE_SLUG } }).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(thrown).toMatchObject({
      status: 301,
      options: { statusCode: 301, params: { slug: `${ID}-incendio-estructural-2026-10-10` } }
    });
  });

  it("serve the page at the Costa Rica-date slug", async () => {
    await expect(
      loader({ params: { slug: `${ID}-incendio-estructural-2026-10-10` } })
    ).resolves.toEqual(page());
  });

  it("redirect old markdown URLs to the Costa Rica-date markdown page", async () => {
    const response = await handlers.GET({
      request: new Request(`http://localhost/incidentes/${UTC_DATE_SLUG}.md`),
      params: { slug: `${UTC_DATE_SLUG}.md` },
      next: () => Promise.resolve(new Response("html"))
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toMatch(
      new RegExp(`/incidentes/${ID}-incendio-estructural-2026-10-10\\.md$`)
    );
  });
});
