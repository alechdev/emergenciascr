import { ArrowRightIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import {
  StationDetailsIncidentCard,
  StationDetailsIncidentCardSkeleton
} from "@/components/stations/station-details-incident-card";
import { listIncidentsOptions } from "@/lib/api/@tanstack/react-query.gen";
import { Route } from "@/routes/_dashboard/estaciones/$name";

export function StationDetailsRecentIncidents() {
  const { station } = Route.useLoaderData();
  const { data } = useSuspenseQuery(
    listIncidentsOptions({
      query: {
        stations: [station.id],
        sort: ["id", "desc"],
        pageSize: 5
      }
    })
  );

  const lat = parseFloat(station.latitude);
  const lng = parseFloat(station.longitude);
  const delta = 0.04;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Últimos incidentes</h2>
        <Link
          to="/incidentes"
          search={{
            stations: [String(station.id)],
            view: "map" as const,
            northBound: lat + delta,
            southBound: lat - delta,
            eastBound: lng + delta,
            westBound: lng - delta,
            zoom: 13
          }}
          className="group inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          Ver todos
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      {data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay incidentes recientes para esta estación.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.data.map((incident) => (
            <StationDetailsIncidentCard
              key={incident.id}
              incident={incident}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function StationDetailsRecentIncidentsSkeleton({ count = 5 }: { count?: number }) {
  const keys = Array.from({ length: count }, (_, i) => i + 1);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Últimos incidentes</h2>
      <div className="flex flex-col gap-2">
        {keys.map((key) => (
          <StationDetailsIncidentCardSkeleton key={key} />
        ))}
      </div>
    </section>
  );
}
