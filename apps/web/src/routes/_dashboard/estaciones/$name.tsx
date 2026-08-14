import { createFileRoute, notFound } from "@tanstack/react-router";
import { Suspense } from "react";

import { JsonLdScript } from "@/components/seo/json-ld-script";
import {
  StationDetailsCollaborations,
  StationDetailsCollaborationsSkeleton
} from "@/components/stations/station-details-collaborations";
import {
  StationDetailsHeatmapSection,
  StationDetailsHeatmapSectionSkeleton
} from "@/components/stations/station-details-heatmap-section";
import {
  StationDetailsHighlightedIncidents,
  StationDetailsHighlightedIncidentsSkeleton
} from "@/components/stations/station-details-highlighted-incidents";
import {
  StationDetailsProfileHeader,
  StationDetailsProfileHeaderSkeleton
} from "@/components/stations/station-details-profile-header";
import {
  StationDetailsRecentIncidents,
  StationDetailsRecentIncidentsSkeleton
} from "@/components/stations/station-details-recent-incidents";
import {
  StationDetailsVehicles,
  StationDetailsVehiclesSkeleton
} from "@/components/stations/station-details-vehicles";
import { markdownResponse, prefersMarkdown, splitMarkdownPathSlug } from "@/lib/accepts-markdown";
import { getStationByName } from "@/lib/api";
import { client } from "@/lib/api/client.gen";
import { buildFireStationJsonLd } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/site";
import { getStationPage } from "@/server/stations/get-station-page";
import { stationPageToMarkdown } from "@/server/stations/to-markdown";

export const Route = createFileRoute("/_dashboard/estaciones/$name")({
  ssr: true,
  loader: async ({ params }) => {
    const { name } = params;
    const decodedName = decodeURIComponent(name);

    const isServer = typeof window === "undefined";
    const baseUrl = isServer
      ? process.env.SERVER_INTERNAL_URL
      : import.meta.env.VITE_SERVER_URL || "/api";

    client.setConfig({ baseUrl });

    const { data } = await getStationByName({
      path: {
        name: decodedName
      }
    });

    if (!data?.station) {
      throw notFound();
    }

    return {
      station: data.station
    };
  },
  server: {
    handlers: {
      GET: async ({ request, params, next }) => {
        const { slug: rawName, fromMarkdownPath } = splitMarkdownPathSlug(params.name);
        if (!fromMarkdownPath && !prefersMarkdown(request)) {
          return next();
        }

        const name = decodeURIComponent(rawName).trim();
        const page = await getStationPage({ data: { name } });
        if (!page) {
          return markdownResponse("# No encontrado\n\nNo se encontró la estación.\n", {
            status: 404
          });
        }

        if (name !== page.station.name) {
          const encodedName = encodeURIComponent(page.station.name);
          const canonicalPath = fromMarkdownPath
            ? `/estaciones/${encodedName}.md`
            : `/estaciones/${encodedName}`;
          return new Response(null, {
            status: 301,
            headers: {
              Location: `${SITE_URL}${canonicalPath}`,
              Vary: "Accept"
            }
          });
        }

        return markdownResponse(stationPageToMarkdown(page));
      }
    }
  },
  head: ({ loaderData, params }) => {
    const stationName =
      loaderData?.station?.name ?? decodeURIComponent(params.name).replace(/-/g, " ");
    const title = `Estación ${stationName} — Emergencias CR`;
    const description = `Detalles y estadísticas de incidentes atendidos por la estación de ${stationName}.`;
    const stationUrl = `${SITE_URL}/estaciones/${encodeURIComponent(stationName)}`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: stationUrl },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:url", content: stationUrl }
      ],
      links: [
        { rel: "canonical", href: stationUrl },
        { rel: "alternate", type: "text/markdown", href: `${stationUrl}.md` }
      ]
    };
  },
  component: EstacionDetailPage,
  pendingComponent: PageSkeleton
});

function EstacionDetailPage() {
  const { station } = Route.useLoaderData();
  const stationUrl = `${SITE_URL}/estaciones/${encodeURIComponent(station.name)}`;

  const jsonLd = buildFireStationJsonLd({
    name: station.name,
    url: stationUrl,
    stationKey: station.stationKey,
    address: station.address,
    phoneNumber: station.phoneNumber,
    email: station.email,
    latitude: station.latitude,
    longitude: station.longitude,
    imageUrl: station.imageUrl,
    isOperative: station.isOperative
  });

  return (
    <div className="flex flex-col gap-6">
      <JsonLdScript data={jsonLd} />
      <div className="grid w-full grid-cols-1 gap-6 md:gap-8 lg:grid-cols-3">
        <aside className="top-[calc(var(--app-top-offset)+2rem)] self-start lg:sticky">
          <StationDetailsProfileHeader station={station} />
        </aside>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Suspense fallback={<StationDetailsHighlightedIncidentsSkeleton />}>
            <StationDetailsHighlightedIncidents />
          </Suspense>
          <Suspense fallback={<StationDetailsHeatmapSectionSkeleton />}>
            <StationDetailsHeatmapSection />
          </Suspense>
          <Suspense fallback={<StationDetailsRecentIncidentsSkeleton />}>
            <StationDetailsRecentIncidents />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<StationDetailsCollaborationsSkeleton />}>
        <StationDetailsCollaborations />
      </Suspense>
      <Suspense fallback={<StationDetailsVehiclesSkeleton />}>
        <StationDetailsVehicles />
      </Suspense>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid w-full grid-cols-1 gap-6 md:gap-8 lg:grid-cols-3">
        <aside className="top-(--app-top-offset) self-start lg:sticky">
          <StationDetailsProfileHeaderSkeleton />
        </aside>
        <div className="flex flex-col gap-6 lg:col-span-2">
          <StationDetailsHighlightedIncidentsSkeleton />
          <StationDetailsHeatmapSectionSkeleton />
          <StationDetailsRecentIncidentsSkeleton />
        </div>
      </div>
      <StationDetailsCollaborationsSkeleton />
      <StationDetailsVehiclesSkeleton />
    </div>
  );
}
