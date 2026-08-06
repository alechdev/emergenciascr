import { ArrowRightIcon, QuestionIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { IncidentCard, IncidentCardSkeleton } from "@/components/incidents/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listIncidentsOptions } from "@/lib/api/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";

function LatestIncidentsCtaCard() {
  return (
    <Link
      to="/incidentes"
      className="group flex h-full items-center justify-center bg-card p-4 transition-colors hover:bg-accent/40">
      <div className="flex flex-col items-center gap-2 text-center">
        <ArrowRightIcon className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
        <span className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors group-hover:text-foreground group-hover:underline">
          Ver todos los incidentes
        </span>
      </div>
    </Link>
  );
}

export function LatestIncidents() {
  const latestOptions = listIncidentsOptions({
    query: {
      pageSize: 5,
      sort: ["id", "desc"]
    }
  });

  const { data, isLoading, isError } = useQuery({
    ...latestOptions,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000
  });

  const latestIncidents = data?.data ?? [];
  const latestCards = [
    ...latestIncidents.map((incident) => ({ type: "incident" as const, incident })),
    { type: "cta" as const }
  ];

  return (
    <section className="rail-divider-top flex flex-col py-8">
      <div className="flex flex-wrap items-center gap-3 py-2 max-lgx:py-1">
        <Popover>
          <PopoverTrigger
            aria-label="Información sobre incidentes recientes"
            className="text-muted-foreground transition-colors hover:text-foreground"
            delay={150}
            openOnHover>
            <QuestionIcon className="size-4" />
          </PopoverTrigger>
          <PopoverContent
            side="top"
            tooltipStyle>
            Incidentes reportados más recientemente en el sistema.
          </PopoverContent>
        </Popover>
        <h2 className="text-sm font-semibold tracking-wide uppercase">Recientes</h2>
      </div>

      <div className="relative">
        <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-y-0">
          {isLoading || isError
            ? isError
              ? [1, 2, 3, 4, 5, 6].map((key) => (
                  <div
                    key={key}
                    className={cn(
                      "border-b *:h-full *:rounded-none *:border-0 md:border-r md:border-b md:odd:border-r md:even:border-r-0 md:nth-last-[-n+2]:border-b-0",
                      key > 1 && "hidden md:block"
                    )}>
                    {key === 6 ? <LatestIncidentsCtaCard /> : <IncidentCardSkeleton />}
                  </div>
                ))
              : [1, 2, 3, 4, 5, 6].map((key) => (
                  <div
                    key={key}
                    className="border-b *:h-full *:rounded-none *:border-0 md:border-r md:border-b md:odd:border-r md:even:border-r-0 md:nth-last-[-n+2]:border-b-0">
                    {key === 6 ? <LatestIncidentsCtaCard /> : <IncidentCardSkeleton />}
                  </div>
                ))
            : latestCards.map((item, idx) => (
                <div
                  key={item.type === "incident" ? item.incident.id : "latest-incidents-cta"}
                  className={cn(
                    "border-b *:h-full *:rounded-none *:border-0 md:border-r md:even:border-r-0",
                    idx >= latestCards.length - 2 && "md:border-b-0",
                    idx === latestCards.length - 1 && "border-b-0"
                  )}>
                  {item.type === "incident" ? (
                    <IncidentCard incident={item.incident} />
                  ) : (
                    <LatestIncidentsCtaCard />
                  )}
                </div>
              ))}
        </div>
        {isError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 p-4 text-center text-sm text-muted-foreground backdrop-blur-sm">
            <WarningIcon className="size-6" />
            Ocurrió un error cargando los últimos incidentes
          </div>
        ) : null}
      </div>
    </section>
  );
}
