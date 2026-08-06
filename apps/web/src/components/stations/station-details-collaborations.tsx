import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { getStationCollaborationsOptions } from "@/lib/api/@tanstack/react-query.gen";
import { Route } from "@/routes/_dashboard/estaciones/$name";

import type { GetStationCollaborationsResponse } from "@/lib/api/types.gen";

export function StationDetailsCollaborations() {
  const { station } = Route.useLoaderData();
  const { data } = useSuspenseQuery(
    getStationCollaborationsOptions({
      path: { name: station.name }
    })
  );

  if (data.collaborations.length === 0) {
    return null;
  }

  return (
    <section className="my-6 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Colaboraciones con otras estaciones</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.collaborations.map((station) => (
          <CollaborationCard
            key={station.id}
            station={station}
          />
        ))}
      </div>
    </section>
  );
}

interface CollaborationCardProps {
  station: GetStationCollaborationsResponse["collaborations"][number];
}

function CollaborationCard({ station }: CollaborationCardProps) {
  return (
    <Link
      to="/estaciones/$name"
      params={{ name: encodeURIComponent(station.name) }}
      className="group block overflow-hidden rounded-xl bg-card shadow-md hover:shadow-xl">
      <div className="relative aspect-2/1 w-full bg-muted">
        <img
          src={station.imageUrl}
          alt={station.name}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute bottom-0 left-5 flex h-10 w-10 translate-y-1/2 items-center justify-center rounded-full bg-primary font-mono text-xs font-bold text-primary-foreground ring-4 ring-card">
          {station.stationKey}
        </div>
      </div>
      <div className="flex flex-col gap-2 px-5 pt-7 pb-5">
        <h3 className="text-lg leading-tight font-bold text-foreground group-hover:text-primary">
          {station.name}
        </h3>
        <p className="text-sm text-foreground">
          Trabajaron en conjunto en{" "}
          <strong>{station.collaborationCount.toLocaleString("es-CR")}</strong>{" "}
          {station.collaborationCount === 1 ? "incidente" : "incidentes"}.
        </p>
      </div>
    </Link>
  );
}

export function StationDetailsCollaborationsSkeleton() {
  return (
    <section className="my-6 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Colaboraciones con otras estaciones</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }, (_, i) => (
          <CollaborationCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

function CollaborationCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-md">
      <div className="relative">
        <Skeleton className="aspect-2/1 w-full" />
        <Skeleton className="absolute bottom-0 left-5 h-10 w-10 translate-y-1/2 rounded-full ring-4 ring-card" />
      </div>
      <div className="flex flex-col gap-2 px-5 pt-7 pb-5">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}
