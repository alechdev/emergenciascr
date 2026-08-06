import { FireTruckIcon, GarageIcon, WarningIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime } from "@/lib/utils";

import type { ListIncidentsResponse } from "@/lib/api/types.gen";

interface StationDetailsIncidentCardProps {
  incident: ListIncidentsResponse["data"][number];
}

/**
 * Get gradient classes based on heat level (vehicles + stations deployment)
 */
function getHeatGradient(heat: number): string {
  if (heat >= 10) return "from-red-500 to-orange-500";
  if (heat >= 5) return "from-orange-500 to-yellow-500";
  return "from-yellow-500 to-green-500";
}

export function StationDetailsIncidentCard({ incident }: StationDetailsIncidentCardProps) {
  const heat = incident.dispatchedStationsCount + incident.dispatchedVehiclesCount;

  return (
    <Link
      to="/incidentes/$slug"
      params={{ slug: String(incident.id) }}
      className="flex overflow-hidden rounded-lg bg-card hover:bg-accent/10">
      <div className="relative flex aspect-square w-24 shrink-0 items-center justify-center p-1.5">
        {incident.mapImageUrl ? (
          <div className="h-full w-full overflow-hidden rounded-lg">
            <img
              src={incident.mapImageUrl}
              alt={`Mapa del incidente ${incident.importantDetails ?? ""}`}
              className="h-full w-full rounded-lg object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : (
          <div className="relative h-full w-full overflow-hidden rounded-lg">
            <div
              className={cn("absolute inset-0 rounded-lg bg-linear-to-r", getHeatGradient(heat))}
            />
            <div className="relative flex h-full w-full items-center justify-center">
              <div className="w-fit rounded-md bg-background/60 px-2 py-1.5 backdrop-blur-3xl">
                <WarningIcon
                  className="size-4 text-amber-500"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-2 pr-3 pl-1.5">
        <h3 className="line-clamp-1 text-sm leading-snug font-medium">
          {incident.importantDetails ?? "Sin detalles"}
        </h3>
        {incident.address && (
          <p className="line-clamp-1 text-xs text-muted-foreground">{incident.address}</p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <GarageIcon className="size-3.5" />
              <span className="text-xs font-medium">{incident.dispatchedStationsCount}</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <FireTruckIcon className="size-3.5" />
              <span className="text-xs font-medium">{incident.dispatchedVehiclesCount}</span>
            </div>
          </div>
          <span
            className="shrink-0 text-xs whitespace-nowrap text-muted-foreground first-letter:uppercase"
            suppressHydrationWarning>
            {formatRelativeTime(incident.incidentTimestamp)}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function StationDetailsIncidentCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex overflow-hidden rounded-lg bg-card", className)}>
      <div className="relative aspect-square w-24 shrink-0 p-1.5">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-2 pr-3 pl-1.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-4 w-8" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </div>
  );
}
