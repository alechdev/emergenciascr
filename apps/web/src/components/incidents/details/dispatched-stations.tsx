import { Link } from "@tanstack/react-router";

import { SectionHeading } from "@/components/incidents/details/section-heading";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPlaceName } from "@/lib/incident-editorial";
import { Route } from "@/routes/_dashboard/incidentes/$slug";

export function DispatchedStations() {
  const { stations } = Route.useLoaderData();

  // Filter out stations without a valid stationKey (vehicles dispatched but station not dispatched)
  const validStations = stations.filter(
    (station) => station.stationKey && station.stationKey.trim() !== ""
  );

  if (validStations.length === 0) {
    return null;
  }

  // Sort: responsible station first, then by stationKey (numeric)
  const sortedStations = [...validStations].sort((a, b) => {
    if (a.isResponsible && !b.isResponsible) return -1;
    if (!a.isResponsible && b.isResponsible) return 1;
    return a.stationKey.localeCompare(b.stationKey, undefined, { numeric: true });
  });

  return (
    <section aria-labelledby="estaciones">
      <SectionHeading
        id="estaciones"
        title="Estaciones despachadas"
      />
      <ul className="mt-4 divide-y border-y">
        {sortedStations.map((station) => (
          <li key={station.name}>
            <Link
              to="/estaciones/$name"
              params={{ name: station.name }}
              className="group flex items-baseline gap-4 py-3.5">
              <span className="w-10 shrink-0 text-sm text-muted-foreground tabular-nums">
                {station.stationKey}
              </span>
              <span className="shrink-0">
                <span className="transition-colors group-hover:text-primary">
                  {formatPlaceName(station.name)}
                </span>
                {station.isResponsible && (
                  <span className="ms-2 text-xs text-muted-foreground">Responsable</span>
                )}
              </span>
              {station.vehicles.length > 0 && (
                <span className="min-w-0 flex-1 text-right text-sm text-balance text-muted-foreground tabular-nums">
                  {station.vehicles.map((vehicle, index) => (
                    <span key={vehicle.internalNumber}>
                      {index > 0 && ", "}
                      <span className="whitespace-nowrap">{vehicle.internalNumber}</span>
                    </span>
                  ))}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DispatchedStationsSkeleton() {
  return (
    <section>
      <Skeleton className="h-7 w-64" />
      <ul className="mt-4 divide-y border-y">
        {Array.from({ length: 2 }).map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-4 py-4">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="ms-auto h-4 w-20" />
          </li>
        ))}
      </ul>
    </section>
  );
}
