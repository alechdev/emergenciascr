import { FireTruckIcon, GarageIcon, WarningIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime } from "@/lib/utils";

import type { ListIncidentsResponse } from "@/lib/api/types.gen";

type HighlightedIncident = ListIncidentsResponse["data"][number];

function getHeatGradient(heat: number): string {
  if (heat < 0.25) {
    return "from-sky-600/90 via-cyan-500/90 to-teal-500/90";
  }
  if (heat < 0.45) {
    return "from-cyan-500/90 via-teal-500/90 to-emerald-500/90";
  }
  if (heat < 0.65) {
    return "from-emerald-500/90 via-lime-500/90 to-amber-500/90";
  }
  if (heat < 0.85) {
    return "from-amber-500/90 via-orange-500/90 to-rose-500/90";
  }
  return "from-orange-500/90 via-red-500/90 to-red-700/90";
}

export function HighlightedIncidentCard({ incident }: { incident: HighlightedIncident }) {
  const total = incident.dispatchedStationsCount + incident.dispatchedVehiclesCount;
  const heat = Math.max(0, Math.min((total - 2) / 13, 1));
  const dispatchType = incident.dispatchType?.name ?? "Sin tipo";

  return (
    <Link
      to="/incidentes/$slug"
      params={{ slug: incident.slug }}
      className="group relative flex h-full flex-col overflow-hidden bg-card transition-colors hover:bg-accent/40">
      <div className="relative aspect-2/1 w-full overflow-hidden">
        {incident.mapImageUrl ? (
          <div className="h-full w-full overflow-hidden">
            <img
              src={incident.mapImageUrl}
              alt={`Mapa del incidente ${incident.importantDetails}`}
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : (
          <div className="relative h-full w-full overflow-hidden">
            <div className={cn("absolute inset-0 bg-linear-to-br", getHeatGradient(heat))} />
            <div className="relative flex h-full w-full items-center justify-center">
              <div className="w-fit border border-white/20 bg-black/30 px-3 py-1.5 backdrop-blur-md">
                <p className="flex items-center gap-1.5 text-xs whitespace-nowrap select-none">
                  <WarningIcon
                    className="size-3.5 shrink-0 text-amber-300"
                    aria-hidden="true"
                  />
                  Sin coordenadas disponibles
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="absolute top-2 left-2 flex max-w-[80%] flex-col items-start gap-0.5">
          <span className="max-w-full truncate bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {dispatchType}
          </span>
          <span className="bg-black/60 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white backdrop-blur-sm first-letter:uppercase">
            {formatRelativeTime(incident.incidentTimestamp)}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col border-t">
        <div className="space-y-0.5 p-3">
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold tracking-tight">
            {incident.importantDetails}
          </h3>
          <p className="line-clamp-1 text-xs text-muted-foreground">{incident.address}</p>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-1.5">
          <span className="inline-flex items-center gap-1 bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <GarageIcon className="size-3.5" />
            {incident.dispatchedStationsCount} estaciones
          </span>
          <span className="inline-flex items-center gap-1 bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <FireTruckIcon className="size-3.5" />
            {incident.dispatchedVehiclesCount} vehículos
          </span>
        </div>
      </div>
    </Link>
  );
}

export function HighlightedIncidentCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden bg-card", className)}>
      <div className="relative aspect-2/1 w-full overflow-hidden">
        <Skeleton className="h-full w-full rounded-none" />
        <div className="absolute top-2 left-2 flex max-w-[80%] flex-col items-start gap-0.5">
          <Skeleton className="h-4 w-24 rounded-none" />
          <Skeleton className="h-4 w-20 rounded-none" />
        </div>
      </div>
      <div className="flex flex-1 flex-col border-t">
        <div className="space-y-0.5 p-3">
          <Skeleton className="h-5 w-11/12" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-1.5">
          <Skeleton className="h-5 w-24 rounded-none" />
          <Skeleton className="h-5 w-24 rounded-none" />
        </div>
      </div>
    </div>
  );
}
