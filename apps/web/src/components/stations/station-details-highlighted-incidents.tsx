import { useSuspenseQuery } from "@tanstack/react-query";

import {
  StationDetailsHighlightedCard,
  StationDetailsHighlightedCardSkeleton
} from "@/components/stations/station-details-highlighted-card";
import { listIncidentsOptions } from "@/lib/api/@tanstack/react-query.gen";
import { Route } from "@/routes/_dashboard/estaciones/$name";

export function StationDetailsHighlightedIncidents() {
  const { station } = Route.useLoaderData();
  const { data } = useSuspenseQuery(
    listIncidentsOptions({
      query: {
        stations: [station.id],
        sort: ["totalDispatched", "desc"],
        pageSize: 6
      }
    })
  );

  if (data.data.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Incidentes destacados</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {data.data.map((incident) => (
          <StationDetailsHighlightedCard
            key={incident.id}
            incident={incident}
          />
        ))}
      </div>
    </section>
  );
}

export function StationDetailsHighlightedIncidentsSkeleton({ count = 6 }: { count?: number }) {
  const keys = Array.from({ length: count }, (_, i) => i + 1);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Incidentes destacados</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {keys.map((key) => (
          <StationDetailsHighlightedCardSkeleton key={key} />
        ))}
      </div>
    </section>
  );
}
