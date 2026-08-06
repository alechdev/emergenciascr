import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { getIncidentsByHourOptions } from "@/lib/api/@tanstack/react-query.gen";
import { Route } from "@/routes/_dashboard/index";

type HourlyIncidentsDatum = {
  hourStart: string;
  hourLabel: string;
  hoursAgo: number;
  incidents: number;
};

type HourlyIncidentsChartDatum = HourlyIncidentsDatum & {
  bucketLabel: string;
};

type HourlyIncidentsXAxisLabel = {
  key: string;
  shortLabel: string;
  tooltipLabel: string;
};

const ALLOWED_HOURLY_INCIDENTS_RANGE_VALUES = [24, 48, 72] as const;
const DEFAULT_HOURLY_INCIDENTS_RANGE = 24;

const HOURLY_INCIDENTS_RANGE_LABELS = {
  24: "24 horas",
  48: "48 horas",
  72: "72 horas"
} as const;

const HOURLY_CHART_MIN_WIDTH_BY_RANGE = {
  24: "min-w-full",
  48: "min-w-[760px] lg:min-w-full",
  72: "min-w-[1040px] lg:min-w-full"
} as const;

const chartConfig = {
  incidents: {
    label: "Incidentes",
    color: "var(--chart-1)"
  }
} satisfies ChartConfig;

const numberFormatter = new Intl.NumberFormat("es-CR");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatYAxisIncidentsTick(value: number) {
  if (value < 10) {
    return Number(value.toFixed(1));
  }

  return Math.round(value);
}

function formatHoursAgo(hoursAgo: number) {
  if (hoursAgo === 0) {
    return "Hace menos de 1 hora";
  }

  if (hoursAgo === 1) {
    return "Hace 1 hora";
  }

  return `Hace ${hoursAgo} horas`;
}

function buildXAxisLabels(
  data: HourlyIncidentsChartDatum[],
  maxLabels: number
): HourlyIncidentsXAxisLabel[] {
  if (!data.length) {
    return [];
  }

  const buildLabel = (item: HourlyIncidentsChartDatum, index: number) => ({
    key: `${item.hourStart}-${index}`,
    shortLabel: item.hourLabel,
    tooltipLabel: `${item.hourLabel} - ${formatHoursAgo(item.hoursAgo)}`
  });

  if (data.length <= maxLabels) {
    return data.map((item, index) => buildLabel(item, index));
  }

  const lastIndex = data.length - 1;
  const candidateIndexes = Array.from({ length: maxLabels }, (_, index) =>
    Math.round((index * lastIndex) / (maxLabels - 1))
  );
  const uniqueIndexes = [...new Set(candidateIndexes)];

  return uniqueIndexes.flatMap((index) => {
    const item = data[index];

    if (!item) {
      return [];
    }

    return [buildLabel(item, index)];
  });
}

interface HourlyIncidentsTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: HourlyIncidentsChartDatum;
  }>;
}

function HourlyIncidentsTooltipContent({ active, payload }: HourlyIncidentsTooltipProps) {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const point = payload[0]?.payload;

  if (!point) {
    return null;
  }

  const incidents = Number(point.incidents ?? 0);

  return (
    <div className="rounded-md border border-zinc-700/80 bg-zinc-950/95 px-2.5 py-2 text-xs text-zinc-200 shadow-lg">
      <p className="font-medium text-zinc-100">{point.hourLabel}</p>
      <p className="mt-0.5 text-zinc-400">{formatHoursAgo(point.hoursAgo)}</p>
      <p className="mt-1 text-zinc-300">{formatNumber(incidents)} incidentes</p>
    </div>
  );
}

export function RecentIncidentsHoursBarChart() {
  const { incidentsByHourTimeRange } = Route.useSearch();
  const selectedTimeRange = incidentsByHourTimeRange ?? DEFAULT_HOURLY_INCIDENTS_RANGE;

  const { data, isLoading, isError } = useQuery({
    ...getIncidentsByHourOptions({
      query: {
        timeRange: selectedTimeRange
      }
    }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000
  });

  const maxXAxisLabels = selectedTimeRange <= 24 ? 6 : selectedTimeRange <= 48 ? 8 : 10;
  const scrollContentClassName = HOURLY_CHART_MIN_WIDTH_BY_RANGE[selectedTimeRange];

  const chartData = useMemo(
    () =>
      (data?.data ?? []).map((item) => ({
        ...item,
        bucketLabel: `${item.hoursAgo}h`
      })),
    [data]
  );

  const xAxisLabels = useMemo(
    () => buildXAxisLabels(chartData, maxXAxisLabels),
    [chartData, maxXAxisLabels]
  );

  return (
    <section className="flex flex-col gap-0">
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-3">
        <div className="xl:col-span-3">
          <div className="border border-t-0 border-zinc-800/70 bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 max-lgx:py-2">
              <h2 className="text-sm font-semibold tracking-wide uppercase">Incidentes por hora</h2>

              <Tabs value={String(selectedTimeRange)}>
                <TabsList
                  variant="underline"
                  className="h-8">
                  {ALLOWED_HOURLY_INCIDENTS_RANGE_VALUES.map((value) => (
                    <TabsTab
                      key={value}
                      value={String(value)}
                      render={
                        <Link
                          to="."
                          search={(prev) => ({
                            ...prev,
                            incidentsByHourTimeRange:
                              value === DEFAULT_HOURLY_INCIDENTS_RANGE ? undefined : value
                          })}
                          replace
                          resetScroll={false}
                        />
                      }
                      className="rounded-none border-none px-3 py-1.5 text-sm">
                      {HOURLY_INCIDENTS_RANGE_LABELS[value]}
                    </TabsTab>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="w-full px-2 pb-0 sm:px-3 sm:pb-0">
              {isLoading ? (
                <div
                  className="overflow-x-auto"
                  tabIndex={0}
                  aria-label="Grafico desplazable de incidentes por hora">
                  <div className={`w-full ${scrollContentClassName}`}>
                    <div className="h-[140px] w-full sm:h-[152px] lg:h-[120px]">
                      <Skeleton className="h-full w-full bg-zinc-800" />
                    </div>

                    <ol
                      className="mt-0 grid gap-1"
                      style={{
                        gridTemplateColumns: `repeat(${maxXAxisLabels}, minmax(0, 1fr))`
                      }}>
                      {Array.from({ length: maxXAxisLabels }).map((_, index) => (
                        <li
                          key={`hourly-chart-skeleton-label-${index}`}
                          className="flex min-w-0 justify-center">
                          <Skeleton className="h-4 w-10 bg-zinc-800" />
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ) : isError ? (
                <div className="flex h-[140px] items-center justify-center px-4 text-sm text-muted-foreground sm:h-[152px] lg:h-[120px]">
                  No se pudieron cargar los incidentes por hora.
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex h-[140px] items-center justify-center px-4 text-sm text-muted-foreground sm:h-[152px] lg:h-[120px]">
                  No hay datos de incidentes para este periodo.
                </div>
              ) : (
                <div
                  className="overflow-x-auto"
                  tabIndex={0}
                  aria-label="Grafico desplazable de incidentes por hora">
                  <div className={`w-full ${scrollContentClassName}`}>
                    <ChartContainer
                      config={chartConfig}
                      className="aspect-auto h-[140px] w-full sm:h-[152px] lg:h-[120px]">
                      <BarChart
                        accessibilityLayer
                        data={chartData}
                        barCategoryGap="10%"
                        margin={{ top: 12, right: 8, bottom: 0, left: 6 }}>
                        <CartesianGrid
                          vertical={false}
                          strokeDasharray="3 3"
                        />
                        <XAxis
                          dataKey="bucketLabel"
                          hide
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          width={1}
                          mirror
                          tickMargin={6}
                          tickCount={4}
                          tick={{
                            fill: "var(--muted-foreground)",
                            fontSize: 10,
                            opacity: 0.65,
                            dy: -5
                          }}
                          tickFormatter={(value) =>
                            formatYAxisIncidentsTick(Number(value)).toLocaleString("es-CR")
                          }
                        />
                        <Bar
                          dataKey="incidents"
                          fill="var(--color-incidents)"
                          radius={2}
                          animationDuration={500}
                          activeBar={{ fill: "var(--chart-2)" }}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={<HourlyIncidentsTooltipContent />}
                        />
                      </BarChart>
                    </ChartContainer>

                    <ol
                      className="mt-0 grid gap-1"
                      style={{
                        gridTemplateColumns: `repeat(${xAxisLabels.length || 1}, minmax(0, 1fr))`
                      }}>
                      {xAxisLabels.map((item) => (
                        <li
                          key={item.key}
                          className="min-w-0 text-center">
                          <p
                            className="truncate text-[11px] leading-4 text-zinc-400"
                            title={item.tooltipLabel}>
                            {item.shortLabel}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
