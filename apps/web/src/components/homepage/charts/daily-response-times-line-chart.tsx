import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { getDailyResponseTimesOptions } from "@/lib/api/@tanstack/react-query.gen";
import { formatMinutesToHMS } from "@/lib/utils";
import {
  ALLOWED_TIME_RANGE_VALUES,
  DEFAULT_TIME_RANGE,
  Route,
  TIME_RANGE_LABELS
} from "@/routes/_dashboard/index";

type DailyResponseTimeDatum = {
  date: Date;
  label: string;
  avgResponseMinutes: number;
};

type DailyResponseTimeChartDatum = DailyResponseTimeDatum & {
  avgResponseMinutesSolid: number | null;
  avgResponseMinutesTodaySegment: number | null;
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: DailyResponseTimeDatum;
  }>;
}

const chartConfig = {
  avgResponseMinutes: {
    label: "Tiempo promedio",
    color: "var(--chart-1)"
  }
} satisfies ChartConfig;

const dayFormatter = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
  timeZone: "America/Costa_Rica"
});

const tooltipDateFormatter = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Costa_Rica"
});

const costaRicaDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/Costa_Rica"
});

function parseDateInCostaRica(dateString: string) {
  return new Date(`${dateString}T00:00:00-06:00`);
}

function getCostaRicaDateKey(date: Date) {
  return costaRicaDateKeyFormatter.format(date);
}

function getTickStep(timeRange: number) {
  if (timeRange <= 7) return 1;
  if (timeRange <= 30) return 5;
  if (timeRange <= 90) return 14;
  return 30;
}

function formatYAxisMinutesTick(value: number) {
  if (value < 10) {
    return `${Number(value.toFixed(1))}m`;
  }

  return `${Math.round(value)}m`;
}

export function DailyResponseTimesLineChart() {
  const { dailyResponseTimesTimeRange } = Route.useSearch();
  const selectedTimeRange = dailyResponseTimesTimeRange ?? DEFAULT_TIME_RANGE;

  const { data, isLoading, isError } = useQuery({
    ...getDailyResponseTimesOptions({
      query: {
        timeRange: selectedTimeRange
      }
    }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000
  });

  const chartData = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.data.map((item) => {
      const date = parseDateInCostaRica(item.date);

      return {
        date,
        label: dayFormatter.format(date),
        avgResponseMinutes: Number((item.averageResponseTimeSeconds / 60).toFixed(1))
      } satisfies DailyResponseTimeDatum;
    });
  }, [data]);

  const chartSeriesData = useMemo(() => {
    if (!chartData.length) {
      return [];
    }

    const todayDateKey = getCostaRicaDateKey(new Date());
    const todayIndex = chartData.findIndex(
      (item) => getCostaRicaDateKey(item.date) === todayDateKey
    );

    return chartData.map((item, index) => {
      const isToday = index === todayIndex;
      const isTodaySegmentPoint =
        todayIndex >= 0 && (index === todayIndex || index === todayIndex - 1);

      return {
        ...item,
        avgResponseMinutesSolid: isToday ? null : item.avgResponseMinutes,
        avgResponseMinutesTodaySegment: isTodaySegmentPoint ? item.avgResponseMinutes : null
      } satisfies DailyResponseTimeChartDatum;
    });
  }, [chartData]);

  const tickStep = useMemo(() => getTickStep(selectedTimeRange), [selectedTimeRange]);

  return (
    <section className="flex flex-col gap-0">
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-3">
        <div className="xl:col-span-3">
          <div className="border border-t-0 border-zinc-800/70 bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3">
              <h2 className="text-sm font-semibold tracking-wide uppercase">
                Tiempos de respuesta
              </h2>

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
                            dailyResponseTimesTimeRange:
                              value === DEFAULT_TIME_RANGE ? undefined : value
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

            {isLoading ? (
              <div className="h-[320px] w-full px-2 pb-2 sm:px-3 sm:pb-3">
                <Skeleton className="h-full w-full bg-zinc-800" />
              </div>
            ) : isError ? (
              <div className="flex h-[320px] items-center justify-center px-4 pb-4 text-sm text-muted-foreground">
                No se pudieron cargar los tiempos de respuesta.
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex h-[320px] items-center justify-center px-4 pb-4 text-sm text-muted-foreground">
                No hay datos de tiempos de respuesta para este periodo.
              </div>
            ) : (
              <ChartContainer
                config={chartConfig}
                className="max-h-[320px] w-full px-2 pb-2 font-mono sm:px-3 sm:pb-3">
                <LineChart
                  accessibilityLayer
                  data={chartSeriesData}
                  margin={{ top: 12, right: 12, bottom: 6, left: 0 }}>
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value, index) => {
                      if (index % tickStep === 0 || index === chartSeriesData.length - 1) {
                        return value;
                      }

                      return "";
                    }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={1}
                    mirror
                    tickMargin={6}
                    tickCount={5}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10, opacity: 0.65, dy: -5 }}
                    tickFormatter={(value) => formatYAxisMinutesTick(Number(value))}
                  />
                  <ChartTooltip
                    cursor={{ stroke: "var(--color-avgResponseMinutes)", strokeOpacity: 0.25 }}
                    content={<CustomTooltipContent />}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgResponseMinutesSolid"
                    stroke="var(--color-avgResponseMinutes)"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{
                      r: 5,
                      fill: "var(--color-avgResponseMinutes)",
                      stroke: "var(--background)",
                      strokeWidth: 2
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgResponseMinutesTodaySegment"
                    stroke="var(--color-avgResponseMinutes)"
                    strokeDasharray="3 2"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{
                      r: 5,
                      fill: "var(--color-avgResponseMinutes)",
                      stroke: "var(--background)",
                      strokeWidth: 2
                    }}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CustomTooltipContent({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const point = payload[0]?.payload;

  if (!point) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-background p-3 shadow-sm">
      <div className="space-y-1">
        <div className="font-medium">{tooltipDateFormatter.format(point.date)}</div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">Tiempo promedio:</span>
          <span className="font-mono text-sm font-medium">
            {formatMinutesToHMS(point.avgResponseMinutes)}
          </span>
        </div>
      </div>
    </div>
  );
}
