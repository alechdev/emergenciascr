import { ArrowRightIcon, QuestionIcon, WarningIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";

import { PieCenter } from "@/components/charts/pie-center";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { getIncidentsByTypeOptions } from "@/lib/api/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import {
  ALLOWED_TIME_RANGE_VALUES,
  DEFAULT_TIME_RANGE,
  Route as DashboardRoute,
  TIME_RANGE_LABELS
} from "@/routes/_dashboard/index";

import type { PieData } from "@/components/charts/pie-context";

const chartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--accent-foreground)"
];

type IncidentTypeChartData = PieData & {
  code: string | null;
  incidentsSearch: {
    incidentCodes: string[];
    start: string;
    end: string;
  } | null;
};

function getDateRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

export function IncidentTypesChart() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const { incidentTypesTimeRange } = DashboardRoute.useSearch();
  const selectedTimeRange = incidentTypesTimeRange ?? DEFAULT_TIME_RANGE;
  const { start, end } = useMemo(() => getDateRange(selectedTimeRange), [selectedTimeRange]);

  const { data, isLoading, isError } = useQuery({
    ...getIncidentsByTypeOptions({
      query: {
        end,
        limit: 6,
        start
      }
    }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  });

  const pieData = useMemo<IncidentTypeChartData[]>(() => {
    return (data ?? []).map((item, index) => {
      const isOther = item.name.toLowerCase() === "otros";
      const code = isOther ? null : item.code;
      return {
        label: item.name,
        value: item.count,
        color: isOther ? "var(--muted-foreground)" : chartColors[index % chartColors.length],
        code,
        incidentsSearch: code
          ? {
              incidentCodes: [code],
              start,
              end
            }
          : null
      } satisfies IncidentTypeChartData;
    });
  }, [data, end, start]);

  const total = useMemo(() => pieData.reduce((sum, item) => sum + item.value, 0), [pieData]);
  const isInitialLoading = isLoading && pieData.length === 0;
  const hasError = !isInitialLoading && (isError || pieData.length === 0);

  const numberFormatter = useMemo(() => new Intl.NumberFormat("es-CR"), []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4 max-lgx:py-2">
        <div className="flex shrink-0 items-center gap-2">
          <Popover>
            <PopoverTrigger
              aria-label="Información sobre tipos de incidente"
              className="text-muted-foreground transition-colors hover:text-foreground"
              delay={150}
              openOnHover>
              <QuestionIcon className="size-4" />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              tooltipStyle>
              Distribución de tipos de incidente más comunes.
            </PopoverContent>
          </Popover>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Tipos de incidente</h2>
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
                      incidentTypesTimeRange: value === DEFAULT_TIME_RANGE ? undefined : value
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

      {isInitialLoading ? (
        <div className="grid min-h-[360px] min-w-0 grid-cols-1 gap-6 rounded-lg p-4 md:p-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          <div className="mx-auto w-full max-w-[320px]">
            <Skeleton className="aspect-square w-full rounded-full" />
          </div>
          <div className="grid min-w-0 content-start gap-0">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`incident-types-skeleton-item-${index}`}
                className="py-1">
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ) : hasError ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 rounded-lg p-4 text-center text-sm text-muted-foreground">
          <WarningIcon className="size-6" />
          Ocurrió un error cargando los tipos de incidente
        </div>
      ) : (
        <div className="grid min-h-[360px] min-w-0 grid-cols-1 gap-6 rounded-lg p-4 md:p-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          <div className="mx-auto w-full max-w-[320px]">
            <PieChart
              className="mx-auto"
              cornerRadius={3}
              data={pieData}
              hoverOffset={8}
              hoveredIndex={hoveredIndex}
              innerRadius={72}
              onHoverChange={setHoveredIndex}
              padAngle={0.01}>
              {pieData.map((item, index) => (
                <PieSlice
                  key={item.code ?? `${item.label}-${index}`}
                  hoverEffect="translate"
                  index={index}
                />
              ))}
              <PieCenter defaultLabel="Incidentes" />
            </PieChart>
          </div>

          <div className="grid min-w-0 content-start gap-0">
            {pieData.map((item, index) => {
              const percentage = total > 0 ? (item.value / total) * 100 : 0;
              const isActive = hoveredIndex === index;
              const isMuted = hoveredIndex !== null && hoveredIndex !== index;
              const itemKey = item.code ?? `${item.label}-${index}`;
              const rowClassName = cn(
                "flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-md px-3 py-2 transition-colors",
                isActive ? "bg-primary/10" : "group-hover:bg-muted/50"
              );

              if (item.incidentsSearch) {
                return (
                  <Fragment key={itemKey}>
                    <Link
                      to="/incidentes"
                      search={item.incidentsSearch}
                      className={cn(
                        "group hidden w-full min-w-0 cursor-pointer rounded-md py-1 text-left no-underline sm:block",
                        isMuted && "opacity-60"
                      )}
                      onBlur={() => setHoveredIndex(null)}
                      onFocus={() => setHoveredIndex(index)}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}>
                      <div className={rowClassName}>
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                        <span className="shrink-0 text-sm font-medium tabular-nums">
                          {numberFormatter.format(item.value)}
                        </span>
                        <span className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                          {percentage.toFixed(1)}%
                        </span>
                      </div>
                    </Link>

                    <div
                      className={cn(
                        "group w-full min-w-0 rounded-md py-1 text-left sm:hidden",
                        isMuted && "opacity-60"
                      )}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}>
                      <div className={rowClassName}>
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                        <span className="shrink-0 text-sm font-medium tabular-nums">
                          {numberFormatter.format(item.value)}
                        </span>
                        <Link
                          to="/incidentes"
                          search={item.incidentsSearch}
                          className="inline-flex shrink-0 items-center justify-between gap-2 text-xs font-medium text-primary no-underline"
                          onBlur={() => setHoveredIndex(null)}
                          onFocus={() => setHoveredIndex(index)}>
                          <span>Ver</span>
                          <ArrowRightIcon className="size-3.5" />
                        </Link>
                      </div>
                    </div>
                  </Fragment>
                );
              }

              return (
                <button
                  key={itemKey}
                  className={cn(
                    "group w-full min-w-0 rounded-md py-1 text-left",
                    "cursor-default",
                    isMuted && "opacity-60"
                  )}
                  onBlur={() => setHoveredIndex(null)}
                  onFocus={() => setHoveredIndex(index)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  type="button">
                  <div className={rowClassName}>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {numberFormatter.format(item.value)}
                    </span>
                    <span className="hidden w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">
                      {percentage.toFixed(1)}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
