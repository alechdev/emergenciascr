import {
  getIncidentRobotsContent,
  isIncidentIndexable
} from "@bomberoscr/lib/incident-indexability";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import {
  IncidentHeader,
  IncidentHeaderSkeleton,
  IncidentRecord,
  IncidentStory,
  IncidentStorySkeleton
} from "@/components/incidents/details/article";
import {
  DispatchedStations,
  DispatchedStationsSkeleton
} from "@/components/incidents/details/dispatched-stations";
import {
  VehicleResponseTimes,
  VehicleResponseTimesSkeleton
} from "@/components/incidents/details/vehicle-response-times";
import { JsonLdScript } from "@/components/seo/json-ld-script";
import { markdownResponse, prefersMarkdown, splitMarkdownPathSlug } from "@/lib/accepts-markdown";
import { buildIncidentDescription } from "@/lib/incident-description";
import { buildIncidentJsonLd } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/site";
import { getIncidentPage } from "@/server/incidents/get-incident-page";
import { incidentPageToMarkdown } from "@/server/incidents/to-markdown";

const ONE_MINUTE_MS = 60_000;

export const Route = createFileRoute("/_dashboard/incidentes/$slug")({
  ssr: true,
  // Matches the open-incident API TTL. Router staleTime is a scalar, so closed
  // incidents share this 1-minute floor instead of the API's 3-hour cache.
  staleTime: ONE_MINUTE_MS,
  loader: async ({ params }) => {
    const { slug } = params;

    const page = await getIncidentPage({ data: { slug } });
    if (!page) {
      throw notFound();
    }

    // Titles (and thus pretty slugs) can change after close; ID is stable.
    // Permanently redirect outdated / partial slugs to the current canonical.
    if (slug !== page.incident.slug) {
      throw redirect({
        to: "/incidentes/$slug",
        params: { slug: page.incident.slug },
        replace: true,
        statusCode: 301
      });
    }

    return page;
  },
  server: {
    handlers: {
      GET: async ({ request, params, next }) => {
        const { slug, fromMarkdownPath } = splitMarkdownPathSlug(params.slug);
        if (!fromMarkdownPath && !prefersMarkdown(request)) {
          return next();
        }

        const page = await getIncidentPage({ data: { slug } });
        if (!page) {
          return markdownResponse("# No encontrado\n\nNo se encontró el incidente.\n", {
            status: 404
          });
        }

        if (slug !== page.incident.slug) {
          const canonicalPath = fromMarkdownPath
            ? `/incidentes/${page.incident.slug}.md`
            : `/incidentes/${page.incident.slug}`;
          return new Response(null, {
            status: 301,
            headers: {
              Location: `${SITE_URL}${canonicalPath}`,
              Vary: "Accept"
            }
          });
        }

        return markdownResponse(incidentPageToMarkdown(page));
      }
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { incident, stations } = loaderData;

    const dispatchedStationsCount = stations.length;
    const dispatchedVehiclesCount = stations.reduce(
      (acc, station) => acc + station.vehicles.length,
      0
    );
    const totalDispatched = dispatchedStationsCount + dispatchedVehiclesCount;
    const indexable = isIncidentIndexable({
      isOpen: incident.isOpen,
      incidentTimestamp: incident.incidentTimestamp,
      totalDispatched
    });
    const robotsContent = getIncidentRobotsContent(indexable);

    const description = buildIncidentDescription(incident, stations);

    const titleWithLocation = incident.title;
    const fullUrl = `${SITE_URL}/incidentes/${incident.slug}`;
    const ogImageUrl = `${SITE_URL}/api/incidents/${incident.id}/og`;

    return {
      meta: [
        { title: `${titleWithLocation} | EE-${incident.EEConsecutive}` },
        { name: "description", content: description },
        { name: "robots", content: robotsContent },
        {
          name: "googlebot",
          content: indexable
            ? "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
            : "noindex, follow"
        },
        { property: "og:title", content: titleWithLocation },
        { property: "og:description", content: description },
        { property: "og:url", content: fullUrl },
        { property: "og:type", content: "article" },
        { property: "og:image", content: ogImageUrl },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: titleWithLocation },
        { name: "twitter:description", content: description },
        { name: "twitter:url", content: fullUrl },
        { name: "twitter:image", content: ogImageUrl }
      ],
      links: [
        { rel: "canonical", href: fullUrl },
        { rel: "alternate", type: "text/markdown", href: `${fullUrl}.md` }
      ]
    };
  },
  pendingComponent: IncidentDetailSkeleton,
  component: IncidenteDetailPage
});

// The headline and map run wider than the reading column beneath them.
const pageClassName = "mx-auto flex w-full max-w-4xl flex-col gap-14 pt-4 pb-32";
const columnClassName = "mx-auto flex w-full max-w-2xl flex-col gap-16";

function IncidentDetailSkeleton() {
  return (
    <div className={pageClassName}>
      <IncidentHeaderSkeleton />
      <div className={columnClassName}>
        <IncidentStorySkeleton />
        <VehicleResponseTimesSkeleton />
        <DispatchedStationsSkeleton />
      </div>
    </div>
  );
}

function IncidenteDetailPage() {
  const { incident, stations } = Route.useLoaderData();

  const description = buildIncidentDescription(incident, stations);

  const jsonLd = buildIncidentJsonLd({
    title: incident.title,
    description,
    url: `${SITE_URL}/incidentes/${incident.slug}`,
    datePublished: incident.incidentTimestamp,
    dateModified: incident.modifiedAt,
    address: incident.address,
    latitude: incident.latitude,
    longitude: incident.longitude,
    isOpen: incident.isOpen,
    eeConsecutive: incident.EEConsecutive,
    incidentId: incident.id
  });

  return (
    <>
      <JsonLdScript data={jsonLd} />
      <article className={pageClassName}>
        <IncidentHeader />
        <div className={columnClassName}>
          <IncidentStory />
          <VehicleResponseTimes />
          <DispatchedStations />
          <IncidentRecord />
        </div>
      </article>
    </>
  );
}
