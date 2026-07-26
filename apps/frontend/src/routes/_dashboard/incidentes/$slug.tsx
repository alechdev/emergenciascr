import {
  getIncidentRobotsContent,
  isIncidentIndexable
} from "@bomberoscr/lib/incident-indexability";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { IncidentArticle, IncidentArticleSkeleton } from "@/components/incidents/details/article";
import {
  DispatchedStations,
  DispatchedStationsSkeleton
} from "@/components/incidents/details/dispatched-stations";
import OpenIncidentBanner from "@/components/incidents/details/open-incident-banner";
import {
  IncidentTimeline,
  IncidentTimelineSkeleton
} from "@/components/incidents/details/timeline";
import {
  VehicleResponseTimes,
  VehicleResponseTimesSkeleton
} from "@/components/incidents/details/vehicle-response-times";
import { JsonLdScript } from "@/components/seo/json-ld-script";
import { getIncidentById } from "@/lib/api";
import { client } from "@/lib/api/client.gen";
import { buildIncidentJsonLd } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/site";

export const Route = createFileRoute("/_dashboard/incidentes/$slug")({
  ssr: true,
  loader: async ({ params }) => {
    const { slug } = params;

    const isServer = typeof window === "undefined";
    const baseUrl = isServer
      ? process.env.SERVER_INTERNAL_URL
      : import.meta.env.VITE_SERVER_URL || "/api";

    client.setConfig({ baseUrl });

    const incidentId = extractIncidentIdFromSlug(slug);

    const { data } = await getIncidentById({
      path: {
        id: incidentId
      }
    });

    if (!data) {
      throw notFound();
    }

    // Titles (and thus pretty slugs) can change after close; ID is stable.
    // Permanently redirect outdated / partial slugs to the current canonical.
    if (slug !== data.slug) {
      throw redirect({
        to: "/incidentes/$slug",
        params: { slug: data.slug },
        replace: true,
        statusCode: 301
      });
    }

    return {
      incident: data
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { incident } = loaderData;

    const formattedDate = new Date(incident.incidentTimestamp).toLocaleDateString("es-CR", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });

    const dispatchedStationsCount = incident.dispatchedStations.length;
    const dispatchedVehiclesCount = incident.dispatchedStations.reduce(
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

    const description = `Incidente reportado el ${formattedDate}${incident.address ? ` en ${incident.address}` : ""}. EE-${incident.EEConsecutive}. ${dispatchedStationsCount} estación(es) y ${dispatchedVehiclesCount} unidad(es) despachadas.`;

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
      links: [{ rel: "canonical", href: fullUrl }]
    };
  },
  pendingComponent: IncidentDetailSkeleton,
  component: IncidenteDetailPage
});

function IncidentDetailSkeleton() {
  return (
    <article className="grid w-full max-w-none grid-cols-1 gap-6 pt-8 pb-24 md:gap-8 lg:grid-cols-3 lg:items-start">
      <div className="order-1 lg:order-1 lg:col-span-2">
        <IncidentArticleSkeleton />
        <VehicleResponseTimesSkeleton />
        <DispatchedStationsSkeleton />
      </div>
      <aside className="order-2 lg:sticky lg:top-[calc(var(--app-header-height)+2rem)] lg:order-2 lg:col-span-1">
        <IncidentTimelineSkeleton />
      </aside>
    </article>
  );
}

function IncidenteDetailPage() {
  const { incident } = Route.useLoaderData();

  const dispatchedStationsCount = incident.dispatchedStations.length;
  const dispatchedVehiclesCount = incident.dispatchedStations.reduce(
    (acc, station) => acc + station.vehicles.length,
    0
  );
  const description = `Incidente reportado el ${new Date(incident.incidentTimestamp).toLocaleDateString("es-CR", { day: "2-digit", month: "long", year: "numeric" })} en ${incident.address}. EE-${incident.EEConsecutive}. ${dispatchedStationsCount} estación(es) y ${dispatchedVehiclesCount} unidad(es) despachadas.`;

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
      <div className="typography grid w-full max-w-none grid-cols-1 gap-6 pt-8 pb-24 md:gap-8 lg:grid-cols-3 lg:items-start">
        {incident.isOpen && (
          <OpenIncidentBanner
            modifiedAt={incident.modifiedAt ?? ""}
            className="not-typography col-span-full"
          />
        )}
        <div className="order-1 flex flex-col gap-4 md:gap-6 lg:order-1 lg:col-span-2">
          <IncidentArticle />
          <VehicleResponseTimes />
          <DispatchedStations />
        </div>
        <aside
          className="not-typography order-2 lg:sticky lg:top-[calc(var(--app-header-height)+2rem)] lg:order-2 lg:col-span-1"
          aria-label="Cronología del incidente">
          <IncidentTimeline />
        </aside>
      </div>
    </>
  );
}

function extractIncidentIdFromSlug(slug: string) {
  const id = Number.parseInt(slug.split("-")[0] ?? "", 10);
  if (Number.isNaN(id)) {
    throw notFound();
  }
  return id;
}
