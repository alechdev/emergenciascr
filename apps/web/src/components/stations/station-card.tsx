import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { GetStationByNameResponse } from "@/lib/api/types.gen";

export function StationCard({ station }: { station: GetStationByNameResponse["station"] }) {
  return (
    <Link
      to="/estaciones/$name"
      params={{ name: station.name }}
      className="group flex h-full">
      <article className="flex w-full flex-col rounded-xl bg-card shadow-md hover:shadow-xl">
        <div className="relative flex-shrink-0">
          <div className="aspect-3/2 w-full overflow-hidden rounded-t-xl bg-muted">
            <img
              src={station.imageUrl}
              alt={`Estación ${station.name}`}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="absolute bottom-0 left-5 flex h-10 w-10 translate-y-1/2 items-center justify-center rounded-full bg-primary font-mono text-xs font-bold text-primary-foreground ring-4 ring-card">
            {station.stationKey}
          </div>
        </div>
        <div className="flex flex-1 flex-col px-5 pt-7 pb-5">
          <h3 className="text-lg leading-tight font-bold tracking-tight text-foreground group-hover:text-primary">
            {station.name}
          </h3>
          {station.address ? (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground/80">
              {station.address}
            </p>
          ) : (
            <div className="flex-1" />
          )}
        </div>
      </article>
    </Link>
  );
}

export function StationCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col rounded-xl bg-card shadow-md", className)}>
      <div className="relative flex-shrink-0">
        <Skeleton className="aspect-3/2 w-full rounded-t-xl" />
        <Skeleton className="absolute bottom-0 left-5 h-10 w-10 translate-y-1/2 rounded-full ring-4 ring-card" />
      </div>
      <div className="flex flex-1 flex-col px-5 pt-7 pb-5">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-1 h-4 w-2/3" />
      </div>
    </div>
  );
}
