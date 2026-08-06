import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { Route } from "@/routes/_dashboard/incidentes/$slug";

import type { GetIncidentByIdResponse } from "@/lib/api";

export function DispatchedStations() {
  const { incident } = Route.useLoaderData();

  // Filter out stations without a valid stationKey (vehicles dispatched but station not dispatched)
  const validStations = incident.dispatchedStations.filter(
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
    <section className="mt-6">
      <h2 id="estaciones">Estaciones despachadas</h2>
      <ul className="not-typography mt-4 ml-0 grid list-none grid-cols-1 gap-4 pl-0 sm:grid-cols-2">
        {sortedStations.map((station) => (
          <li key={station.name}>
            <StationCard station={station} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function StationCard({
  station
}: {
  station: GetIncidentByIdResponse["dispatchedStations"][number];
}) {
  return (
    <Link
      to="/estaciones/$name"
      params={{ name: station.name }}
      className="group block overflow-hidden rounded-xl bg-card shadow-md transition-shadow hover:shadow-xl">
      <div className="relative aspect-3/2 w-full bg-muted">
        <img
          src={station.imageUrl}
          alt={station.name}
          className="h-full w-full object-cover transition-opacity duration-300"
          loading="lazy"
        />
        <div className="absolute bottom-0 left-5 z-10 flex h-10 w-10 translate-y-1/2 items-center justify-center rounded-full bg-primary font-mono text-xs font-bold text-primary-foreground ring-4 ring-card">
          {station.stationKey}
        </div>
      </div>
      <div className="flex flex-col gap-2 px-5 pt-7 pb-5">
        <h3 className="text-lg leading-tight font-bold tracking-tight text-foreground transition-colors group-hover:text-primary sm:line-clamp-1">
          {station.name}
        </h3>
      </div>
    </Link>
  );
}

export function DispatchedStationsSkeleton() {
  return (
    <section className="mt-6">
      <Skeleton className="h-8 w-56" />
      <ul className="not-typography mt-4 ml-0 grid list-none grid-cols-1 gap-4 pl-0 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <li key={i}>
            <StationCardSkeleton />
          </li>
        ))}
      </ul>
    </section>
  );
}

function StationCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm">
      <div className="relative">
        <Skeleton className="aspect-3/2 w-full rounded-none" />
        <Skeleton className="absolute bottom-0 left-5 h-10 w-10 translate-y-1/2 rounded-full ring-4 ring-card" />
      </div>
      <div className="flex flex-col gap-2 px-5 pt-7 pb-5">
        <Skeleton className="h-6 w-40 rounded-md" />
      </div>
    </div>
  );
}
