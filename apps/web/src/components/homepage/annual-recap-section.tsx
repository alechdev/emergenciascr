import { WarningIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PatternLines } from "@visx/pattern";
import { motion, useSpring } from "motion/react";
import { useEffect, useMemo } from "react";

import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { useChart } from "@/components/charts/chart-context";
import { ChartTooltip } from "@/components/charts/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { getYearRecapOptions } from "@/lib/api/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";

import type { GetYearRecapResponse } from "@/lib/api/types.gen";

type TopFiveDatum = {
  label: string;
  shortLabel: string;
  value: number;
  tooltipLabel?: string;
  tooltipSubtitle?: string;
  stationRouteParamName?: string;
};

type RankedTopFiveDatum = TopFiveDatum & {
  rank: number;
  rankLabel: string;
};

type RankedTopFiveChartDatum = RankedTopFiveDatum & {
  remainingToMax: number;
};

const numberFormatter = new Intl.NumberFormat("es-CR");

const longDateFormatter = new Intl.DateTimeFormat("es-CR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Costa_Rica"
});

const shortDateFormatter = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
  timeZone: "America/Costa_Rica"
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function parseDateInCostaRica(dateString: string) {
  return new Date(`${dateString}T00:00:00-06:00`);
}

function compactLabel(value: string, maxLength = 11) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function normalizeTopFive(items: TopFiveDatum[]): RankedTopFiveDatum[] {
  return [...items]
    .sort((first, second) => second.value - first.value)
    .slice(0, 5)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      rankLabel: `#${index + 1}`
    }));
}

function addRemainingToMax(items: RankedTopFiveDatum[]): RankedTopFiveChartDatum[] {
  const maxValue = items[0]?.value ?? 0;

  return items.map((item) => ({
    ...item,
    remainingToMax: Math.max(0, maxValue - item.value)
  }));
}

function AnimatedBarLine({
  barX,
  barTopY,
  barBottomY,
  width,
  isHovered
}: {
  barX: number;
  barTopY: number;
  barBottomY: number;
  width: number;
  isHovered: boolean;
}) {
  const animatedY = useSpring(barBottomY, { stiffness: 300, damping: 30 });

  useEffect(() => {
    animatedY.set(isHovered ? barTopY : barBottomY);
  }, [isHovered, barTopY, barBottomY, animatedY]);

  return (
    <motion.rect
      animate={{ opacity: isHovered ? 1 : 0 }}
      fill="rgba(255,255,255,0.9)"
      height={2}
      initial={false}
      style={{ y: animatedY }}
      transition={{
        opacity: { duration: 0.15 }
      }}
      width={width}
      x={barX}
    />
  );
}

function BarLineIndicators({ data }: { data: RankedTopFiveDatum[] }) {
  const { barScale, bandWidth, innerHeight, yScale, hoveredBarIndex, barXAccessor } = useChart();

  if (!(barScale && bandWidth && barXAccessor)) {
    return null;
  }

  return (
    <g className="pointer-events-none">
      {data.map((item, index) => {
        const barX = barScale(barXAccessor(item)) ?? 0;
        const barTopY = yScale(item.value) ?? innerHeight;
        const valueLabelY = barTopY - 7;

        return (
          <g key={`bar-overlay-${item.rankLabel}`}>
            <AnimatedBarLine
              barBottomY={innerHeight}
              barTopY={barTopY}
              barX={barX}
              isHovered={hoveredBarIndex === index}
              width={bandWidth}
            />
            <text
              className="fill-zinc-300 font-mono text-[10px]"
              textAnchor="middle"
              x={barX + bandWidth / 2}
              y={valueLabelY}>
              {formatNumber(item.value)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

BarLineIndicators.displayName = "ChartMarkers";

function TopFiveRecapBarPanel({
  title,
  unit,
  data,
  barColor,
  className = ""
}: {
  title: string;
  unit: string;
  data: TopFiveDatum[];
  barColor: string;
  className?: string;
}) {
  const rankedData = useMemo(() => normalizeTopFive(data), [data]);
  const chartData = useMemo(() => addRemainingToMax(rankedData), [rankedData]);
  const topItem = rankedData[0];

  return (
    <article className={cn("bg-zinc-900/55 p-4", className)}>
      <p className="text-sm font-semibold tracking-wide uppercase">{title}</p>

      {topItem ? (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="max-w-full truncate text-sm font-semibold text-zinc-100 sm:text-base">
              {topItem.label}
            </h3>
            <span className="text-xs text-zinc-400">
              {formatNumber(topItem.value)} {unit}
            </span>
          </div>

          <div className="mt-4">
            <BarChart
              data={chartData}
              xDataKey="rankLabel"
              stacked
              barGap={0.1}
              margin={{ top: 22, right: 2, bottom: 6, left: 2 }}
              aspectRatio="5 / 1.35">
              <PatternLines
                id="annual-recap-remaining-pattern"
                height={8}
                orientation={["diagonal"]}
                stroke="rgba(161,161,170,0.45)"
                strokeWidth={1.25}
                width={8}
              />
              <Bar
                dataKey="value"
                fill={barColor}
                lineCap="butt"
              />
              <Bar
                dataKey="remainingToMax"
                fill="url(#annual-recap-remaining-pattern)"
                lineCap="butt"
              />
              <ChartTooltip
                showCrosshair={false}
                showDatePill={false}
                showDots={false}
                content={({ point }) => {
                  const pointLabel =
                    typeof point.tooltipLabel === "string"
                      ? point.tooltipLabel
                      : typeof point.label === "string"
                        ? point.label
                        : "";
                  const pointSubtitle =
                    typeof point.tooltipSubtitle === "string" ? point.tooltipSubtitle : "";
                  const pointValue = typeof point.value === "number" ? point.value : 0;

                  return (
                    <div className="rounded-md border border-zinc-700/80 bg-zinc-950/95 px-2.5 py-2 text-xs text-zinc-200 shadow-lg">
                      <p className="max-w-48 truncate font-medium text-zinc-100">{pointLabel}</p>
                      {pointSubtitle && (
                        <p className="mt-0.5 max-w-48 truncate text-[11px] text-zinc-400">
                          {pointSubtitle}
                        </p>
                      )}
                      <p className="mt-1 text-zinc-400">
                        {formatNumber(pointValue)} {unit}
                      </p>
                    </div>
                  );
                }}
              />
              <BarLineIndicators data={chartData} />
            </BarChart>

            <ol className="mt-2 grid grid-cols-5 gap-1">
              {rankedData.map((item) => (
                <li
                  key={`${item.rankLabel}-${item.label}`}
                  className="min-w-0 text-center">
                  {item.stationRouteParamName ? (
                    <Link
                      to="/estaciones/$name"
                      params={{ name: item.stationRouteParamName }}
                      className="block truncate text-[11px] leading-4 text-zinc-400 transition-colors hover:text-zinc-200"
                      title={item.label}>
                      {item.shortLabel}
                    </Link>
                  ) : (
                    <p
                      className="truncate text-[11px] leading-4 text-zinc-400"
                      title={item.label}>
                      {item.shortLabel}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">No hay datos suficientes para mostrar.</p>
      )}
    </article>
  );
}

function AnnualRecapBoard({ data }: { data: GetYearRecapResponse }) {
  const topIncidentDays = useMemo(
    () =>
      data.topIncidentDays.map((item) => {
        const parsedDate = parseDateInCostaRica(item.date);
        return {
          label: longDateFormatter.format(parsedDate),
          shortLabel: shortDateFormatter.format(parsedDate),
          value: item.count
        } satisfies TopFiveDatum;
      }),
    [data.topIncidentDays]
  );

  const topStations = useMemo(
    () =>
      data.topDispatchedStations.map((item) => ({
        label: item.name,
        shortLabel: compactLabel(item.name),
        value: item.count,
        stationRouteParamName: item.name
      })),
    [data.topDispatchedStations]
  );

  const topVehicles = useMemo(
    () =>
      data.topDispatchedVehicles.map((item) => ({
        label: item.internalNumber,
        shortLabel: item.internalNumber,
        tooltipLabel: item.internalNumber,
        tooltipSubtitle: item.stationName,
        value: item.count
      })),
    [data.topDispatchedVehicles]
  );

  return (
    <div className="grid grid-cols-1 gap-0 divide-y divide-zinc-800/70 border border-zinc-800/70 xl:grid-cols-3 xl:divide-x xl:divide-y-0">
      <TopFiveRecapBarPanel
        title="Días con más incidentes"
        unit="incidentes"
        data={topIncidentDays}
        barColor="var(--chart-2)"
        className="h-full"
      />

      <TopFiveRecapBarPanel
        title="Estaciones más despachadas"
        unit="despachos"
        data={topStations}
        barColor="var(--chart-1)"
        className="h-full"
      />

      <TopFiveRecapBarPanel
        title="Vehículos más despachados"
        unit="despachos"
        data={topVehicles}
        barColor="var(--chart-3)"
        className="h-full"
      />
    </div>
  );
}

function AnnualRecapBoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-0 divide-y divide-zinc-800/70 border border-zinc-800/70 xl:grid-cols-3 xl:divide-x xl:divide-y-0">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`annual-recap-skeleton-${index}`}
          className="h-full bg-zinc-900/55 p-4">
          <Skeleton className="h-5 w-44 bg-zinc-800" />
          <div className="mt-2 flex items-center gap-3">
            <Skeleton className="h-6 w-3/5 bg-zinc-800" />
            <Skeleton className="h-4 w-20 bg-zinc-800" />
          </div>
          <div className="mt-4 aspect-[5/1.35] w-full">
            <Skeleton className="h-full w-full bg-zinc-800" />
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1">
            {Array.from({ length: 5 }).map((__, lineIndex) => (
              <div
                key={`annual-recap-skeleton-label-${index}-${lineIndex}`}
                className="flex flex-col items-center gap-1">
                <Skeleton className="h-4 w-10 bg-zinc-800" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AnnualRecapSection() {
  const annualRecapQueryOptions = getYearRecapOptions();

  const { data, isLoading, isError } = useQuery({
    ...annualRecapQueryOptions,
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 30 * 60 * 1000
  });

  if (isLoading) {
    return (
      <section className="flex flex-col gap-0">
        <AnnualRecapBoardSkeleton />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="flex flex-col gap-0">
        <div className="relative">
          <AnnualRecapBoardSkeleton />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-background/70 p-4 text-center text-sm text-muted-foreground backdrop-blur-sm">
            <WarningIcon className="size-6" />
            Ocurrió un error cargando las estadísticas anuales
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-0">
      <AnnualRecapBoard data={data} />
    </section>
  );
}
