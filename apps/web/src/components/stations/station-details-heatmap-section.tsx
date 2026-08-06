import { useSuspenseQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { getStationHeatmapOptions } from "@/lib/api/@tanstack/react-query.gen";
import { Route } from "@/routes/_dashboard/estaciones/$name";

import {
  StationDetailsIncidentsHeatmap,
  StationDetailsIncidentsHeatmapSkeleton
} from "./station-details-incidents-heatmap";

export function StationDetailsHeatmapSection() {
  const { station } = Route.useLoaderData();
  const { data } = useSuspenseQuery(
    getStationHeatmapOptions({
      path: { name: station.name }
    })
  );

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Actividad del último año</h2>
        <span className="text-sm text-muted-foreground">{data.totalIncidents} incidentes</span>
      </header>
      <StationDetailsIncidentsHeatmap data={data.data} />
    </section>
  );
}

export function StationDetailsHeatmapSectionSkeleton() {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Actividad del último año</h2>
        <Skeleton className="h-5 w-24" />
      </header>
      <StationDetailsIncidentsHeatmapSkeleton />
    </section>
  );
}
