import { QuestionIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import {
  HighlightedIncidentCard,
  HighlightedIncidentCardSkeleton
} from "@/components/homepage/highlighted-incident-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { listIncidentsOptions } from "@/lib/api/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import {
  ALLOWED_TIME_RANGE_VALUES,
  DEFAULT_TIME_RANGE,
  Route,
  TIME_RANGE_LABELS
} from "@/routes/_dashboard/index";

function getDateRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

export function HighlightedIncidents() {
  const { highlightedTimeRange } = Route.useSearch();
  const selectedTimeRange = highlightedTimeRange ?? DEFAULT_TIME_RANGE;

  const { start, end } = useMemo(() => getDateRange(selectedTimeRange), [selectedTimeRange]);

  const { data, isLoading, isError } = useQuery({
    ...listIncidentsOptions({
      query: {
        sort: ["totalDispatched", "desc"],
        pageSize: 6,
        start,
        end
      }
    }),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000
  });

  const incidents = data?.data ?? [];

  return (
    <section className="flex flex-col py-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4 max-lgx:py-2">
        <div className="flex shrink-0 items-center gap-2">
          <Popover>
            <PopoverTrigger
              aria-label="Información sobre incidentes destacados"
              className="text-muted-foreground transition-colors hover:text-foreground"
              delay={150}
              openOnHover>
              <QuestionIcon className="size-4" />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              tooltipStyle>
              Incidentes a los que se despachó la mayor cantidad de estaciones y vehículos en el
              periodo seleccionado.
            </PopoverContent>
          </Popover>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Destacados</h2>
        </div>
        <Tabs value={String(selectedTimeRange)}>
          <TabsList
            variant="underline"
            className="h-8">
            {ALLOWED_TIME_RANGE_VALUES.map((value) => (
              <TabsTab
                key={value}
                value={String(value)}
                render={
                  <Link
                    to="."
                    search={(prev) => ({
                      ...prev,
                      highlightedTimeRange: value === DEFAULT_TIME_RANGE ? undefined : value
                    })}
                    replace
                    resetScroll={false}
                  />
                }
                className="rounded-none border-none px-3 py-1.5 text-sm">
                {TIME_RANGE_LABELS[value]}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="relative">
        <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-y-0">
          {isLoading || isError
            ? isError
              ? // On error: show 1 card on mobile, 6 on md+
                [1, 2, 3, 4, 5, 6].map((key) => (
                  <div
                    key={key}
                    className={cn(
                      "border-b md:border-r md:border-b md:odd:border-r md:even:border-r-0 md:nth-last-[-n+2]:border-b-0",
                      key > 1 && "hidden md:block"
                    )}>
                    <HighlightedIncidentCardSkeleton />
                  </div>
                ))
              : [1, 2, 3, 4, 5, 6].map((key) => (
                  <div
                    key={key}
                    className="border-b md:border-r md:border-b md:odd:border-r md:even:border-r-0 md:nth-last-[-n+2]:border-b-0">
                    <HighlightedIncidentCardSkeleton />
                  </div>
                ))
            : incidents.map((incident, idx) => (
                <div
                  key={incident.id}
                  className={cn(
                    "border-b md:border-r md:even:border-r-0",
                    idx >= incidents.length - 2 && "md:border-b-0",
                    idx === incidents.length - 1 && "border-b-0"
                  )}>
                  <HighlightedIncidentCard incident={incident} />
                </div>
              ))}
        </div>
        {isError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 p-4 text-center text-sm text-muted-foreground backdrop-blur-sm">
            <WarningIcon className="size-6" />
            Ocurrió un error cargando los incidentes destacados
          </div>
        ) : null}
      </div>
    </section>
  );
}
