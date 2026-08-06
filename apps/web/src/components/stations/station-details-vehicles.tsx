import { useSuspenseQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getStationVehiclesOptions } from "@/lib/api/@tanstack/react-query.gen";
import { Route } from "@/routes/_dashboard/estaciones/$name";

function formatResponseTime(seconds: number | null): string {
  if (seconds === null) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

export function StationDetailsVehicles() {
  const { station } = Route.useLoaderData();
  const { data } = useSuspenseQuery(
    getStationVehiclesOptions({
      path: { name: station.name }
    })
  );

  if (data.vehicles.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Unidades</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.vehicles.map((vehicle) => (
          <article
            key={vehicle.id}
            className="overflow-hidden rounded-2xl border border-border/50 bg-card">
            <div className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <h3 className="text-lg leading-tight font-semibold">
                  {vehicle.internalNumber ?? "Sin número"}
                </h3>
                <p className="truncate text-sm text-muted-foreground">
                  {vehicle.plate ? `Placa ${vehicle.plate}` : "Sin placa"}
                  {vehicle.class && ` - ${vehicle.class}`}
                </p>
              </div>
              <Badge
                variant="outline"
                className="rounded-full text-xs">
                {vehicle.descriptionOperationalStatus ?? "Desconocido"}
              </Badge>
            </div>

            <div className="flex border-t border-border/50">
              <div className="flex flex-1 flex-col gap-1 p-4">
                <p className="text-xl font-semibold tabular-nums">
                  {vehicle.stats.incidentCount.toLocaleString("es-CR")}
                </p>
                <p className="text-xs text-muted-foreground">Despachos en 30 días</p>
              </div>
              <div className="w-px bg-border/50" />
              <div className="flex flex-1 flex-col gap-1 p-4">
                <p className="text-xl font-semibold tabular-nums">
                  {formatResponseTime(vehicle.stats.avgResponseTimeSeconds)}
                </p>
                <p className="text-xs text-muted-foreground">Tiempo resp. promedio</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function StationDetailsVehiclesSkeleton() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Unidades</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
          <div
            key={id}
            className="overflow-hidden rounded-2xl border border-border/50 bg-card">
            <div className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Skeleton className="mb-2 h-6 w-20" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="flex border-t border-border/50">
              <div className="flex flex-1 flex-col gap-1 p-4">
                <Skeleton className="h-7 w-12" />
                <Skeleton className="h-3 w-28" />
              </div>
              <div className="w-px bg-border/50" />
              <div className="flex flex-1 flex-col gap-1 p-4">
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
