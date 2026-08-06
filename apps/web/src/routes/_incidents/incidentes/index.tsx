import { CompassIcon, ListDashesIcon, SortDescendingIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import z from "zod";

import { IncidentsList } from "@/components/incidents/list";
import { IncidentsMap } from "@/components/incidents/map";
import { IncidentsSearchHeader } from "@/components/incidents/search/header";
import { LogoIcon } from "@/components/layout/logo-icon";
import { JsonLdScript } from "@/components/seo/json-ld-script";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { listIncidentTypes, listStations } from "@/lib/api";
import { client } from "@/lib/api/client.gen";
import { buildCollectionPageJsonLd } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const title = "Incidentes — Emergencias CR";
const description =
  "Consulta el historial de incidentes atendidos por Bomberos de Costa Rica. Filtra por fecha, tipo y estación.";

const SORT_OPTIONS = [
  { value: "newest", label: "Más recientes" },
  { value: "oldest", label: "Más antiguos" },
  { value: "most-dispatched", label: "Más despachados" },
  { value: "least-dispatched", label: "Menos despachados" }
] as const;

const isoDateTimeSearchParam = z.iso.datetime({ offset: true }).optional().catch(undefined);

export const Route = createFileRoute("/_incidents/incidentes/")({
  validateSearch: z.object({
    view: z.enum(["map", "list"]).optional().catch("list"),
    sort: z
      .enum(["newest", "oldest", "most-dispatched", "least-dispatched"])
      .optional()
      .catch("newest"),
    q: z.string().optional().catch(undefined),
    start: isoDateTimeSearchParam,
    end: isoDateTimeSearchParam,
    stations: z.array(z.string()).optional().catch(undefined),
    incidentCodes: z.array(z.string()).optional().catch(undefined),
    open: z.boolean().optional().catch(undefined),
    northBound: z.number().optional().catch(undefined),
    southBound: z.number().optional().catch(undefined),
    eastBound: z.number().optional().catch(undefined),
    westBound: z.number().optional().catch(undefined),
    zoom: z.number().optional().catch(undefined)
  }),
  ssr: false,
  staleTime: Infinity,
  loader: async () => {
    const isServer = typeof window === "undefined";
    const baseUrl = isServer
      ? process.env.SERVER_INTERNAL_URL
      : import.meta.env.VITE_SERVER_URL || "/api";

    client.setConfig({ baseUrl });

    const [{ data: stationsData }, { data: incidentTypesData }] = await Promise.all([
      listStations({
        query: {
          limit: 100,
          operative: "true",
          sort: ["name", "asc"]
        }
      }),
      listIncidentTypes()
    ]);

    return {
      stations: stationsData?.data ?? [],
      incidentTypes: incidentTypesData?.items ?? []
    };
  },
  head: () => {
    const incidentsUrl = `${SITE_URL}/incidentes`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: incidentsUrl },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:url", content: incidentsUrl }
      ],
      links: [{ rel: "canonical", href: incidentsUrl }]
    };
  },

  component: IncidentesPage,
  pendingComponent: () => (
    <div className="mx-auto flex min-h-dvh max-w-6xl items-center justify-center px-6">
      <div className="flex w-full max-w-44 flex-col items-center gap-5">
        <LogoIcon
          className="size-16"
          autoAnimating
        />
        <div className="relative block h-1.5 w-full overflow-hidden rounded-full bg-input">
          <div className="incident-loader-pillow absolute top-1/2 h-1 w-11 -translate-y-1/2 rounded-full bg-primary" />
        </div>
        <span className="sr-only">Cargando incidentes</span>
      </div>
    </div>
  ),
  pendingMinMs: 1500
});

function IncidentesPage() {
  const { stations, incidentTypes } = Route.useLoaderData();
  const search = Route.useSearch();
  const { view } = search;
  const navigate = Route.useNavigate();
  const isMobile = useIsMobile();
  const [isSortSheetOpen, setIsSortSheetOpen] = useState(false);
  const [hoveredIncidentId, setHoveredIncidentId] = useState<number | null>(null);
  const [hasVisitedMap, setHasVisitedMap] = useState(view === "map");
  const isMapView = view === "map";
  const currentSort = search.sort ?? "newest";

  useEffect(() => {
    if (isMobile) {
      setHoveredIncidentId(null);
    }
  }, [isMobile]);

  useEffect(() => {
    if (isMapView) {
      setHasVisitedMap(true);
    }
  }, [isMapView]);

  const pageClassName = isMobile
    ? isMapView
      ? "flex h-dvh flex-col overflow-hidden"
      : "overflow-x-clip"
    : "flex h-[calc(100dvh-var(--app-header-height))] flex-col overflow-hidden";

  const handleToggleView = () => {
    void navigate({
      search: (prev) => ({ ...prev, view: isMapView ? "list" : "map" }),
      replace: true,
      resetScroll: false
    });
  };

  const handleSortChange = (sort: (typeof SORT_OPTIONS)[number]["value"]) => {
    void navigate({
      search: (prev) => ({ ...prev, sort }),
      replace: true,
      resetScroll: false
    });
    setIsSortSheetOpen(false);
  };

  return (
    <div className={pageClassName}>
      <JsonLdScript
        data={buildCollectionPageJsonLd({
          name: title,
          description,
          url: `${SITE_URL}/incidentes`
        })}
      />
      <div className="max-md:sticky max-md:top-0 max-md:z-30 max-md:border-b max-md:border-border max-md:bg-background">
        <IncidentsSearchHeader
          incidentTypes={incidentTypes}
          stations={stations}
        />
      </div>

      {isMobile ? (
        <>
          {(isMapView || hasVisitedMap) && (
            <div className={cn("min-h-0 flex-1", !isMapView && "hidden")}>
              <IncidentsMap
                className="h-full w-full"
                highlightedIncidentId={hoveredIncidentId}
              />
            </div>
          )}
          {!isMapView && <IncidentsList />}
        </>
      ) : (
        <section className="hidden min-h-0 flex-1 md:grid md:grid-cols-[3fr_2fr]">
          <IncidentsMap
            className="h-full w-full"
            highlightedIncidentId={hoveredIncidentId}
          />
          <div className="h-full overflow-y-auto border-l border-border bg-background/35 px-3 pb-3">
            <IncidentsList
              variant="sidebar"
              onIncidentHoverChange={setHoveredIncidentId}
            />
          </div>
        </section>
      )}

      {isMobile && (
        <div className="fixed bottom-4 left-1/2 z-50 mb-4 flex -translate-x-1/2 transform items-center rounded-md border border-border bg-background/45 px-2 py-1 shadow-md backdrop-blur">
          <button
            className="flex items-center gap-2 px-4 py-2"
            onClick={handleToggleView}
            type="button">
            {isMapView ? <ListDashesIcon /> : <CompassIcon />}
            {isMapView ? "Lista" : "Mapa"}
          </button>
          {!isMapView && (
            <>
              <Separator
                orientation="vertical"
                className="my-2"
              />
              <Sheet
                open={isSortSheetOpen}
                onOpenChange={setIsSortSheetOpen}>
                <SheetTrigger
                  render={
                    <button
                      className="flex items-center gap-2 px-4 py-2"
                      type="button"
                    />
                  }>
                  <SortDescendingIcon />
                  Ordenar
                </SheetTrigger>
                <SheetPopup
                  side="right"
                  className="h-dvh w-dvw max-w-none overflow-hidden rounded-none border-none">
                  <SheetHeader>
                    <SheetTitle>Ordenar</SheetTitle>
                  </SheetHeader>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <SheetPanel>
                      <div className="-mx-6">
                        {SORT_OPTIONS.map((option, index) => (
                          <div key={option.value}>
                            <button
                              className="w-full px-6 py-4 text-left"
                              onClick={() => handleSortChange(option.value)}
                              type="button">
                              <span
                                className={
                                  option.value === currentSort
                                    ? "font-semibold text-foreground"
                                    : "text-muted-foreground"
                                }>
                                {option.label}
                              </span>
                            </button>
                            {index < SORT_OPTIONS.length - 1 && <Separator />}
                          </div>
                        ))}
                      </div>
                    </SheetPanel>
                  </div>
                </SheetPopup>
              </Sheet>
            </>
          )}
        </div>
      )}
    </div>
  );
}
