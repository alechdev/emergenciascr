import { FireTruckIcon, GarageIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";

import type { ListIncidentsResponses } from "@/lib/api/types.gen";

type IncidentCardData = ListIncidentsResponses["200"]["data"][number];

type IncidentCardProps = {
  incident: IncidentCardData;
  onIncidentHoverChange?: (incidentId: number | null) => void;
};

function getIncidentImageUrl(incident: IncidentCardData) {
  return (
    incident.specificActualType?.imageUrl ??
    incident.specificDispatchType?.imageUrl ??
    incident.dispatchType?.imageUrl ??
    undefined
  );
}

export function IncidentCard({ incident, onIncidentHoverChange }: IncidentCardProps) {
  const incidentImageUrl = getIncidentImageUrl(incident);

  const handleIncidentHoverStart = () => {
    onIncidentHoverChange?.(incident.id);
  };

  const handleIncidentHoverEnd = () => {
    onIncidentHoverChange?.(null);
  };

  return (
    <Link
      to="/incidentes/$slug"
      params={{ slug: incident.slug }}
      onMouseEnter={handleIncidentHoverStart}
      onMouseLeave={handleIncidentHoverEnd}
      onFocus={handleIncidentHoverStart}
      onBlur={handleIncidentHoverEnd}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      {incidentImageUrl && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
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
            <div className="relative size-16 overflow-hidden rounded-lg bg-muted/50">
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
          <h3 className="line-clamp-1 text-sm leading-tight font-medium">{incident.title}</h3>
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
          <div className="flex items-center gap-1">
            <GarageIcon className="size-4" />
            <span className="font-medium">{incident.dispatchedStationsCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <FireTruckIcon className="size-4" />
            <span className="font-medium">{incident.dispatchedVehiclesCount}</span>
          </div>
        </div>
        <span className="text-muted-foreground first-letter:uppercase">
          {formatRelativeTime(incident.incidentTimestamp)}
        </span>
      </div>
    </Link>
  );
}

export function IncidentCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex gap-3 p-3">
        <Skeleton className="size-16 shrink-0 rounded-lg" />
        <div className="flex flex-1 flex-col justify-center gap-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border/50 bg-muted/30 px-3 py-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}
