import { useSuspenseQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { getStationVehiclesOptions } from "@/lib/api/@tanstack/react-query.gen";
import { Route } from "@/routes/_dashboard/estaciones/$name";

import type { GetStationVehiclesResponse } from "@/lib/api/types.gen";

type StationVehicle = GetStationVehiclesResponse["vehicles"][number];
type VehicleStatus = "available" | "incident" | "out-of-service" | "unknown";

function formatResponseTime(seconds: number | null): string {
  if (seconds === null) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function getVehicleStatus(status: string | null): VehicleStatus {
  const normalizedStatus = status?.trim().toUpperCase() ?? "";
  if (normalizedStatus.includes("FUERA")) return "out-of-service";
  if (normalizedStatus.includes("INCIDENTE")) return "incident";
  if (normalizedStatus.includes("DISPONIBLE")) return "available";
  return "unknown";
}

function getStatusDotClass(status: VehicleStatus): string {
  if (status === "available") return "bg-success";
  if (status === "incident") return "bg-warning";
  if (status === "out-of-service") return "bg-destructive";
  return "bg-muted-foreground";
}

const statusLegend = [
  { key: "available", label: "Disponible" },
  { key: "incident", label: "En incidente" },
  { key: "out-of-service", label: "Fuera de servicio" }
] as const;

function VehicleTitle({ vehicle }: { vehicle: StationVehicle }) {
  return (
    <div className="min-w-0">
      <h3 className="truncate text-lg leading-tight font-semibold">
        {vehicle.internalNumber ?? "Sin número"}
      </h3>
      <p className="truncate text-base text-muted-foreground sm:text-sm">
        {vehicle.plate ? `Placa ${vehicle.plate}` : "Sin placa"}
        {vehicle.class && ` · ${vehicle.class}`}
      </p>
    </div>
  );
}

function VehicleMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="truncate text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function VehicleStatusRail({ vehicle }: { vehicle: StationVehicle }) {
  const status = getVehicleStatus(vehicle.descriptionOperationalStatus);

  return (
    <>
      <span
        aria-hidden="true"
        className={`h-10 w-1 shrink-0 rounded-full ${getStatusDotClass(status)}`}
      />
      <span className="sr-only">
        Estado: {vehicle.descriptionOperationalStatus ?? "Desconocido"}
      </span>
    </>
  );
}

function StatusLegend() {
  return (
    <div
      aria-label="Leyenda de estados"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {statusLegend.map((item) => (
        <span
          key={item.key}
          className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden="true"
            className={`h-3 w-0.5 rounded-full ${getStatusDotClass(item.key)}`}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function OperationsVehicleRows({ vehicles }: { vehicles: StationVehicle[] }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-lg font-semibold">Unidades</h2>
          <p className="text-base text-muted-foreground sm:text-sm">
            {vehicles.length} unidades asignadas
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto sm:justify-end">
          <StatusLegend />
          <p className="hidden font-mono text-xs tracking-wide text-muted-foreground sm:block">
            ÚLTIMOS 30 DÍAS
          </p>
        </div>
      </div>

      <div className="border-y border-border/60">
        {vehicles.map((vehicle) => (
          <article
            key={vehicle.id}
            className="grid gap-4 border-b border-border/60 py-4 transition-colors last:border-b-0 hover:bg-muted/20 sm:grid-cols-[minmax(12rem,1.2fr)_minmax(16rem,1fr)] sm:items-center sm:px-3">
            <div className="flex min-w-0 items-center gap-3">
              <VehicleStatusRail vehicle={vehicle} />
              <VehicleTitle vehicle={vehicle} />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:border-t-0 sm:pt-0">
              <VehicleMetric
                label="Despachos"
                value={vehicle.stats.incidentCount.toLocaleString("es-CR")}
              />
              <VehicleMetric
                label="Respuesta promedio"
                value={formatResponseTime(vehicle.stats.avgResponseTimeSeconds)}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function StationDetailsVehicles() {
  const { station } = Route.useLoaderData();
  const { data } = useSuspenseQuery(
    getStationVehiclesOptions({
      path: { name: station.name }
    })
  );

  if (data.vehicles.length === 0) return null;

  return <OperationsVehicleRows vehicles={data.vehicles} />;
}

export function StationDetailsVehiclesSkeleton() {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="hidden items-center gap-4 sm:flex">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div className="border-y border-border/60">
        {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
          <div
            key={id}
            className="grid gap-4 border-b border-border/60 py-4 last:border-b-0 sm:grid-cols-[minmax(12rem,1.2fr)_minmax(16rem,1fr)] sm:items-center sm:px-3">
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton className="h-10 w-1 shrink-0" />
              <div className="flex min-w-0 flex-col gap-2">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
