import { FireTruckIcon, GarageIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { useIncidentsQuery } from "@/components/incidents/query-options";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Route } from "@/routes/_incidents/incidentes";

import type { ListIncidentsResponses } from "@/lib/api/types.gen";

type IncidentCardData = ListIncidentsResponses["200"]["data"][number];

const MAPBOX_SCRIPT_ID = "mapbox-gl-script";
const MAPBOX_CSS_ID = "mapbox-gl-css";
const MAPBOX_SCRIPT_SRC = "https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.js";
const MAPBOX_CSS_HREF = "https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.css";

const DEFAULT_CENTER: [number, number] = [-84.1, 9.93];
const DEFAULT_ZOOM = 7;
const DEFAULT_BEARING = 0;
const COSTA_RICA_BOUNDS: [number, number, number, number] = [-86.2, 8.0, -82.0, 11.5];
const TERRAIN_SOURCE_ID = "mapbox-dem";
const TERRAIN_SOURCE_URL = "mapbox://mapbox.mapbox-terrain-dem-v1";
const TERRAIN_EXAGGERATION = 1.2;
const MARKER_DEFAULT_COLOR = "#a3000b";
const MARKER_HOVER_COLOR = "#055e16";
const MARKER_TEXT_COLOR = "#ffffff";
const MARKER_BASE_Z_INDEX = "1";
const MARKER_ACTIVE_Z_INDEX = "30";
const MARKER_LABEL_MIN_ZOOM = 11;

type IncidentFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: IncidentCardData & {
      typeLabel: string;
      imageUrl: string | undefined;
    };
  }>;
};

type MapboxPopup = {
  setDOMContent: (node: Node) => MapboxPopup;
  setHTML: (html: string) => MapboxPopup;
  setMaxWidth: (width: string) => MapboxPopup;
};

type MapboxMarker = {
  setLngLat: (coords: [number, number]) => MapboxMarker;
  setPopup: (popup: MapboxPopup) => MapboxMarker;
  addTo: (map: MapboxMap) => MapboxMarker;
  remove: () => void;
};

type IncidentMarkerElements = {
  wrapper: HTMLDivElement;
  bubble: HTMLDivElement;
  arrow: HTMLDivElement;
  tip: HTMLDivElement;
};

type IncidentMapMarker = {
  id: number;
  marker: MapboxMarker;
  elements: IncidentMarkerElements;
  isHovered: boolean;
  cleanup?: () => void;
};

type MapboxMap = {
  addControl: (control: unknown, position?: string) => void;
  addLayer: (layer: Record<string, unknown>) => void;
  addSource: (id: string, source: Record<string, unknown>) => void;
  fitBounds: (bounds: [number, number, number, number], options?: Record<string, unknown>) => void;
  getBounds: () => {
    getNorth: () => number;
    getSouth: () => number;
    getEast: () => number;
    getWest: () => number;
  };
  getCanvas: () => HTMLCanvasElement;
  getSource: (id: string) => { setData: (data: IncidentFeatureCollection) => void } | undefined;
  isStyleLoaded: () => boolean;
  on: (event: string, ...args: unknown[]) => void;
  remove: () => void;
  resize: () => void;
  setTerrain: (terrain: Record<string, unknown> | null) => void;
  getZoom: () => number;
};

type MapboxNamespace = {
  accessToken: string;
  Map: new (options: Record<string, unknown>) => MapboxMap;
  NavigationControl: new () => unknown;
  Marker: new (options?: Record<string, unknown>) => MapboxMarker;
  Popup: new (options?: Record<string, unknown>) => MapboxPopup;
};

declare global {
  interface Window {
    mapboxgl?: MapboxNamespace;
  }
}

function ensureMapboxCss() {
  if (document.getElementById(MAPBOX_CSS_ID)) {
    return;
  }

  const link = document.createElement("link");
  link.id = MAPBOX_CSS_ID;
  link.rel = "stylesheet";
  link.href = MAPBOX_CSS_HREF;
  document.head.appendChild(link);
}

async function loadMapboxScript() {
  if (window.mapboxgl) {
    return window.mapboxgl;
  }

  const existing = document.getElementById(MAPBOX_SCRIPT_ID) as HTMLScriptElement | null;

  if (existing) {
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("No se pudo cargar Mapbox GL JS.")),
        {
          once: true
        }
      );
    });

    if (!window.mapboxgl) {
      throw new Error("Mapbox GL JS no esta disponible.");
    }

    return window.mapboxgl;
  }

  const script = document.createElement("script");
  script.id = MAPBOX_SCRIPT_ID;
  script.src = MAPBOX_SCRIPT_SRC;
  script.async = true;

  await new Promise<void>((resolve, reject) => {
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("No se pudo cargar Mapbox GL JS.")), {
      once: true
    });
    document.head.appendChild(script);
  });

  if (!window.mapboxgl) {
    throw new Error("Mapbox GL JS no esta disponible.");
  }

  return window.mapboxgl;
}

function toIncidentFeatureCollection(incidents: IncidentCardData[]): IncidentFeatureCollection {
  const features = incidents
    .filter(
      (incident) =>
        Number.isFinite(incident.longitude) &&
        Number.isFinite(incident.latitude) &&
        incident.longitude !== 0 &&
        incident.latitude !== 0
    )
    .map((incident) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [incident.longitude, incident.latitude] as [number, number]
      },
      properties: {
        ...incident,
        typeLabel: buildIncidentTypeLabel({
          specificActualTypeName: incident.specificActualType?.name,
          specificDispatchTypeName: incident.specificDispatchType?.name
        }),
        imageUrl:
          incident.specificActualType?.imageUrl ??
          incident.specificDispatchType?.imageUrl ??
          incident.dispatchType?.imageUrl ??
          undefined
      }
    }));

  return {
    type: "FeatureCollection",
    features
  };
}

function fitToFeatures(
  map: MapboxMap,
  features: IncidentFeatureCollection["features"],
  animate: boolean
) {
  if (features.length === 0) {
    return;
  }

  const first = features[0];
  if (!first) {
    return;
  }

  let west = first.geometry.coordinates[0];
  let east = first.geometry.coordinates[0];
  let south = first.geometry.coordinates[1];
  let north = first.geometry.coordinates[1];

  for (const feature of features) {
    const [lng, lat] = feature.geometry.coordinates;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  map.fitBounds([west, south, east, north], {
    padding: 40,
    maxZoom: 12,
    duration: animate ? 500 : 0
  });
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(6));
}

function roundZoom(value: number) {
  return Number(value.toFixed(2));
}

function buildIncidentTypeLabel(incident: {
  specificActualTypeName?: string;
  specificDispatchTypeName?: string;
}) {
  return (
    incident.specificActualTypeName ?? incident.specificDispatchTypeName ?? "Tipo no disponible"
  );
}

function createIncidentMarkerElement({ label }: { label: string }): IncidentMarkerElements {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.maxWidth = "220px";
  wrapper.style.pointerEvents = "auto";
  wrapper.style.cursor = "pointer";
  wrapper.style.zIndex = MARKER_BASE_Z_INDEX;
  wrapper.style.filter = "drop-shadow(0 2px 6px rgba(2, 6, 23, 0.22))";

  const bubble = document.createElement("div");
  bubble.textContent = label;
  bubble.style.padding = "2px 6px";
  bubble.style.borderRadius = "10px";
  bubble.style.backgroundColor = MARKER_DEFAULT_COLOR;
  bubble.style.color = MARKER_TEXT_COLOR;
  bubble.style.fontSize = "11px";
  bubble.style.fontWeight = "600";
  bubble.style.lineHeight = "1.1";
  bubble.style.textAlign = "center";
  bubble.style.maxWidth = "220px";
  bubble.style.whiteSpace = "nowrap";
  bubble.style.overflow = "hidden";
  bubble.style.textOverflow = "ellipsis";
  bubble.style.transition = "background-color 140ms ease";
  bubble.className = "marker-bubble";

  const arrow = document.createElement("div");
  arrow.style.width = "0";
  arrow.style.height = "0";
  arrow.style.borderLeft = "4px solid transparent";
  arrow.style.borderRight = "4px solid transparent";
  arrow.style.borderTop = `5px solid ${MARKER_DEFAULT_COLOR}`;
  arrow.style.marginTop = "-1px";
  arrow.style.transition = "border-top-color 140ms ease";

  const tip = document.createElement("div");
  tip.style.width = "6px";
  tip.style.height = "6px";
  tip.style.borderRadius = "999px";
  tip.style.backgroundColor = MARKER_DEFAULT_COLOR;
  tip.style.marginTop = "-1px";
  tip.style.transition = "background-color 140ms ease";

  wrapper.appendChild(bubble);
  wrapper.appendChild(arrow);
  wrapper.appendChild(tip);

  return {
    wrapper,
    bubble,
    arrow,
    tip
  };
}

function setIncidentMarkerColor(elements: IncidentMarkerElements, color: string) {
  elements.bubble.style.backgroundColor = color;
  elements.arrow.style.borderTop = `5px solid ${color}`;
  elements.tip.style.backgroundColor = color;
}

function shouldShowIncidentMarkerLabel(zoom: number) {
  return zoom >= MARKER_LABEL_MIN_ZOOM;
}

function setIncidentMarkerLabelVisibility(marker: IncidentMapMarker, isVisible: boolean) {
  marker.elements.bubble.style.display = isVisible ? "block" : "none";
  marker.elements.arrow.style.display = isVisible ? "block" : "none";
  marker.elements.tip.style.marginTop = isVisible ? "-1px" : "0";
}

function setIncidentMarkersLabelVisibility(markers: IncidentMapMarker[], isVisible: boolean) {
  for (const marker of markers) {
    setIncidentMarkerLabelVisibility(marker, isVisible);
  }
}

function updateIncidentMarkerAppearance(
  marker: IncidentMapMarker,
  highlightedIncidentId: number | null
) {
  const shouldHighlight = marker.isHovered || marker.id === highlightedIncidentId;
  setIncidentMarkerColor(
    marker.elements,
    shouldHighlight ? MARKER_HOVER_COLOR : MARKER_DEFAULT_COLOR
  );
  marker.elements.wrapper.style.zIndex = shouldHighlight
    ? MARKER_ACTIVE_Z_INDEX
    : MARKER_BASE_Z_INDEX;
}

function renderIncidentMarkers(
  mapboxgl: MapboxNamespace,
  map: MapboxMap,
  features: IncidentFeatureCollection["features"],
  existingMarkers: IncidentMapMarker[],
  showLabels: boolean,
  getHighlightedIncidentId: () => number | null,
  onNavigate: (href: string) => void
): IncidentMapMarker[] {
  const existingMarkersMap = new Map(existingMarkers.map((m) => [m.id, m]));
  const newMarkers: IncidentMapMarker[] = [];

  for (const feature of features) {
    const id = feature.properties.id;
    const existingMarker = existingMarkersMap.get(id);

    if (existingMarker) {
      existingMarker.marker.setLngLat(feature.geometry.coordinates);
      setIncidentMarkerLabelVisibility(existingMarker, showLabels);
      updateIncidentMarkerAppearance(existingMarker, getHighlightedIncidentId());

      newMarkers.push(existingMarker);
      existingMarkersMap.delete(id);
    } else {
      const markerElements = createIncidentMarkerElement({
        label: feature.properties.typeLabel
      });

      const popupContainer = document.createElement("div");
      const root = createRoot(popupContainer);
      const incident = feature.properties;
      const incidentImageUrl = incident.imageUrl;

      root.render(
        <div className="group relative flex w-64 flex-col overflow-hidden rounded-lg border-0 bg-transparent text-left md:w-80">
          {incidentImageUrl && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
              <img
                src={incidentImageUrl}
                alt=""
                aria-hidden="true"
                className="absolute top-1/2 left-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2 scale-110 object-cover opacity-15 blur-2xl transition-transform duration-500 group-hover:scale-125"
                loading="lazy"
                decoding="async"
              />
            </div>
          )}

          <div className="relative flex flex-1 gap-3 p-3">
            {incidentImageUrl && (
              <div className="flex shrink-0 items-center justify-center">
                <div className="relative size-14 overflow-hidden rounded-lg bg-muted/50 md:size-16">
                  <img
                    src={incidentImageUrl}
                    alt="Ilustración del tipo de incidente"
                    className="size-full object-contain p-1.5 drop-shadow-md transition-transform duration-300 group-hover:scale-110"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
              <h3 className="line-clamp-2 text-sm leading-tight font-medium md:line-clamp-1">
                {incident.title}
              </h3>
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {incident.address || "Sin ubicación"}
              </p>
              <span className="text-xs font-medium text-muted-foreground">
                {incident.responsibleStationName ?? "Sin estación responsable"}
              </span>
            </div>
          </div>

          <div className="relative flex items-center justify-between border-t border-border/50 bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-3 text-muted-foreground">
              <div
                className="flex items-center gap-1"
                title="Estaciones despachadas">
                <GarageIcon className="size-4" />
                <span className="font-medium">{incident.dispatchedStationsCount}</span>
              </div>
              <div
                className="flex items-center gap-1"
                title="Unidades despachadas">
                <FireTruckIcon className="size-4" />
                <span className="font-medium">{incident.dispatchedVehiclesCount}</span>
              </div>
            </div>
            <span className="text-muted-foreground first-letter:uppercase">
              {formatRelativeTime(incident.incidentTimestamp)}
            </span>
          </div>

          {incident.isTemporaryCoordinates && (
            <div className="incident-popup-warning-banner relative border-t border-black/20">
              <p className="incident-popup-warning-copy">
                Aún no se tienen las coordenadas de este incidente, esta ubicación es una
                aproximación.
              </p>
            </div>
          )}

          <a
            href={`/incidentes/${incident.slug}`}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(`/incidentes/${incident.slug}`);
            }}
            className="absolute inset-0 z-10 rounded-lg ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none">
            <span className="sr-only">Ver detalles del incidente</span>
          </a>
        </div>
      );

      const popup = new mapboxgl.Popup({
        offset: 25,
        closeButton: false,
        closeOnClick: true,
        className: "incident-popup"
      })
        .setDOMContent(popupContainer)
        .setMaxWidth("none");

      const mapboxMarker = new mapboxgl.Marker({
        element: markerElements.wrapper,
        anchor: "bottom"
      })
        .setLngLat(feature.geometry.coordinates)
        .setPopup(popup)
        .addTo(map);

      const marker: IncidentMapMarker = {
        id: feature.properties.id,
        marker: mapboxMarker,
        elements: markerElements,
        isHovered: false,
        cleanup: () => {
          setTimeout(() => root.unmount(), 0);
          mapboxMarker.remove();
        }
      };

      setIncidentMarkerLabelVisibility(marker, showLabels);

      markerElements.wrapper.addEventListener("mouseenter", () => {
        marker.isHovered = true;
        updateIncidentMarkerAppearance(marker, getHighlightedIncidentId());
      });

      markerElements.wrapper.addEventListener("mouseleave", () => {
        marker.isHovered = false;
        updateIncidentMarkerAppearance(marker, getHighlightedIncidentId());
      });

      updateIncidentMarkerAppearance(marker, getHighlightedIncidentId());

      newMarkers.push(marker);
    }
  }

  for (const marker of existingMarkersMap.values()) {
    if (marker.cleanup) {
      marker.cleanup();
    } else {
      marker.marker.remove();
    }
  }

  return newMarkers;
}

export function IncidentsMap({
  className,
  highlightedIncidentId = null
}: {
  className?: string;
  highlightedIncidentId?: number | null;
}) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, isPending, isError } = useIncidentsQuery(search);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapboxRef = useRef<MapboxNamespace | null>(null);
  const markersRef = useRef<IncidentMapMarker[]>([]);
  const markerLabelsVisibleRef = useRef(shouldShowIncidentMarkerLabel(search.zoom ?? DEFAULT_ZOOM));
  const highlightedIncidentIdRef = useRef<number | null>(highlightedIncidentId);
  const didInitialFitRef = useRef(false);

  const hasSearchBounds =
    search.northBound != null &&
    search.southBound != null &&
    search.eastBound != null &&
    search.westBound != null;

  const initialBoundsRef = useRef<[number, number, number, number] | null>(
    hasSearchBounds
      ? [
          search.westBound as number,
          search.southBound as number,
          search.eastBound as number,
          search.northBound as number
        ]
      : null
  );
  const initialZoomRef = useRef(search.zoom ?? DEFAULT_ZOOM);

  const incidents = data?.data ?? [];
  const featureCollection = useMemo(() => toIncidentFeatureCollection(incidents), [incidents]);
  const featureCollectionRef = useRef(featureCollection);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    featureCollectionRef.current = featureCollection;
  }, [featureCollection]);

  useEffect(() => {
    highlightedIncidentIdRef.current = highlightedIncidentId;

    for (const marker of markersRef.current) {
      updateIncidentMarkerAppearance(marker, highlightedIncidentIdRef.current);
    }
  }, [highlightedIncidentId]);

  useEffect(() => {
    const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

    if (!mapboxToken || !mapContainerRef.current) {
      return;
    }

    let cancelled = false;

    const initializeMap = async () => {
      try {
        ensureMapboxCss();
        const mapboxgl = await loadMapboxScript();

        if (cancelled || !mapContainerRef.current) {
          return;
        }

        mapboxgl.accessToken = mapboxToken;

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: "mapbox://styles/mapbox/standard",
          center: DEFAULT_CENTER,
          zoom: initialZoomRef.current,
          bearing: DEFAULT_BEARING,
          maxBounds: COSTA_RICA_BOUNDS
        });

        map.addControl(new mapboxgl.NavigationControl(), "top-right");
        mapRef.current = map;
        mapboxRef.current = mapboxgl;

        map.on("load", () => {
          map.addSource(TERRAIN_SOURCE_ID, {
            type: "raster-dem",
            url: TERRAIN_SOURCE_URL,
            tileSize: 512,
            maxzoom: 14
          });
          map.setTerrain({
            source: TERRAIN_SOURCE_ID,
            exaggeration: TERRAIN_EXAGGERATION
          });

          if (initialBoundsRef.current) {
            map.fitBounds(initialBoundsRef.current, {
              padding: 40,
              duration: 0,
              maxZoom: 14
            });
            didInitialFitRef.current = true;
          } else {
            fitToFeatures(map, featureCollectionRef.current.features, false);
            didInitialFitRef.current = featureCollectionRef.current.features.length > 0;
          }

          markersRef.current = renderIncidentMarkers(
            mapboxgl,
            map,
            featureCollectionRef.current.features,
            markersRef.current,
            markerLabelsVisibleRef.current,
            () => highlightedIncidentIdRef.current,
            (href) => {
              void navigate({ to: href as any });
            }
          );

          const syncMarkerLabelVisibility = () => {
            const shouldShowLabels = shouldShowIncidentMarkerLabel(map.getZoom());

            if (shouldShowLabels === markerLabelsVisibleRef.current) {
              return;
            }

            markerLabelsVisibleRef.current = shouldShowLabels;
            setIncidentMarkersLabelVisibility(markersRef.current, shouldShowLabels);
          };

          syncMarkerLabelVisibility();

          map.on("zoom", syncMarkerLabelVisibility);

          setMapReady(true);
        });

        map.on("moveend", () => {
          const bounds = map.getBounds();

          void navigate({
            search: (prev) => ({
              ...prev,
              northBound: roundCoordinate(bounds.getNorth()),
              southBound: roundCoordinate(bounds.getSouth()),
              eastBound: roundCoordinate(bounds.getEast()),
              westBound: roundCoordinate(bounds.getWest()),
              zoom: roundZoom(map.getZoom())
            }),
            replace: true,
            resetScroll: false
          });
        });

        const resizeObserver = new ResizeObserver(() => {
          map.resize();
        });

        resizeObserver.observe(mapContainerRef.current);

        return () => {
          resizeObserver.disconnect();
        };
      } catch {
        if (!cancelled) {
          setMapError("No se pudo cargar el mapa.");
        }
      }
    };

    let cleanupObserver: (() => void) | undefined;
    void initializeMap().then((cleanup) => {
      cleanupObserver = cleanup;
    });

    return () => {
      cancelled = true;
      cleanupObserver?.();

      for (const marker of markersRef.current) {
        if (marker.cleanup) {
          marker.cleanup();
        } else {
          marker.marker.remove();
        }
      }
      markersRef.current = [];

      mapRef.current?.remove();
      mapRef.current = null;
      mapboxRef.current = null;
    };
  }, [navigate]);

  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;

    if (!map || !mapboxgl || !map.isStyleLoaded()) {
      return;
    }

    markersRef.current = renderIncidentMarkers(
      mapboxgl,
      map,
      featureCollection.features,
      markersRef.current,
      shouldShowIncidentMarkerLabel(map.getZoom()),
      () => highlightedIncidentIdRef.current,
      (href) => {
        void navigate({ to: href as any });
      }
    );
    markerLabelsVisibleRef.current = shouldShowIncidentMarkerLabel(map.getZoom());

    if (!hasSearchBounds && !didInitialFitRef.current) {
      fitToFeatures(map, featureCollection.features, true);
      didInitialFitRef.current = featureCollection.features.length > 0;
    }
  }, [featureCollection, hasSearchBounds]);

  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

  if (!mapboxToken) {
    return (
      <div
        className={cn("flex size-full min-h-0 items-center justify-center bg-muted/20", className)}>
        <p className="px-6 text-center text-sm text-muted-foreground">
          Configura <code>VITE_MAPBOX_TOKEN</code> para habilitar el mapa.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("relative size-full min-h-0 overflow-hidden", className)}>
      {!mapReady && <Skeleton className="absolute inset-0 rounded-none" />}
      <div
        ref={mapContainerRef}
        className="h-full w-full"
      />

      {isPending && (
        <div className="absolute top-3 left-3 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          Actualizando incidentes...
        </div>
      )}

      {(mapError || isError) && (
        <div className="absolute inset-x-3 bottom-3 rounded-md border border-border bg-background/95 px-3 py-2 text-sm text-muted-foreground shadow-sm">
          {mapError ?? "Ocurrió un error cargando los incidentes del mapa."}
        </div>
      )}
    </div>
  );
}
