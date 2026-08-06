import { eachDayOfInterval, format, startOfWeek, subYears } from "date-fns";
import { es } from "date-fns/locale";
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface StationDetailsIncidentsHeatmapProps {
  data: { date: string; count: number }[];
}

export function StationDetailsIncidentsHeatmap({ data }: StationDetailsIncidentsHeatmapProps) {
  const tooltipHandle = React.useMemo(
    () => TooltipCreateHandle<{ count: number; date: Date }>(),
    []
  );

  const today = new Date();
  const oneYearAgo = subYears(today, 1);
  const startDate = startOfWeek(oneYearAgo, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: startDate, end: today });

  const dataMap = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const d of data) {
      map.set(d.date, d.count);
    }
    return map;
  }, [data]);

  const months = React.useMemo(() => {
    const months: { index: number; label: string }[] = [];
    let lastMonth = -1;

    for (let i = 0; i < days.length; i += 7) {
      const weekStart = days[i];
      if (!weekStart) break;

      const month = weekStart.getMonth();

      if (month !== lastMonth) {
        if (months.length === 1 && months[0] && i / 7 - months[0].index < 2) {
          months.pop();
        }

        months.push({
          index: i / 7,
          label: format(weekStart, "MMM", { locale: es })
        });
        lastMonth = month;
      }
    }
    return months;
  }, [days]);

  const getIntensity = (count: number) => {
    if (count === 0) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 9) return 3;
    return 4;
  };

  const intensityColor = {
    0: "bg-muted",
    1: "bg-primary/20",
    2: "bg-primary/40",
    3: "bg-primary/70",
    4: "bg-primary"
  };

  return (
    <div className="flex flex-col gap-4">
      <TooltipProvider delay={0}>
        <div className="w-full overflow-x-auto">
          <div className="min-w-max">
            <div className="relative mb-2 h-4 text-xs text-muted-foreground">
              {months.map(({ index, label }) => (
                <span
                  key={`${index}-${label}`}
                  className="absolute top-0 text-[10px]"
                  style={{ left: `${index * 0.875}rem` }}>
                  {label.charAt(0).toUpperCase() + label.slice(1)}
                </span>
              ))}
            </div>
            <div
              className="grid min-w-max grid-flow-col grid-rows-7 gap-0 pb-2"
              style={{ height: "auto" }}>
              {days.map((day) => {
                const dateStr = format(day, "yyyy-MM-dd");
                const count = dataMap.get(dateStr) || 0;
                const intensity = getIntensity(count);

                return (
                  <TooltipTrigger
                    key={dateStr}
                    handle={tooltipHandle}
                    payload={{ count, date: day }}
                    className="group block p-[2px]">
                    <div
                      className={cn(
                        "h-2.5 w-2.5 rounded-sm transition-colors group-data-[popup-open]:ring-2 group-data-[popup-open]:ring-primary/20",
                        intensityColor[intensity as keyof typeof intensityColor]
                      )}
                    />
                  </TooltipTrigger>
                );
              })}
            </div>
            <Tooltip handle={tooltipHandle}>
              {({ payload }) => (
                <TooltipPopup className="text-xs">
                  {payload && (
                    <>
                      <span className="font-semibold">{payload.count} incidentes</span>{" "}
                      <span className="text-muted-foreground">
                        el {format(payload.date, "PPP", { locale: es })}
                      </span>
                    </>
                  )}
                </TooltipPopup>
              )}
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <span>Menos</span>
        <div className="flex gap-1">
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[0])} />
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[1])} />
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[2])} />
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[3])} />
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[4])} />
        </div>
        <span>Más</span>
      </div>
    </div>
  );
}

export function StationDetailsIncidentsHeatmapSkeleton() {
  const intensityColor = {
    0: "bg-muted",
    1: "bg-primary/20",
    2: "bg-primary/40",
    3: "bg-primary/70",
    4: "bg-primary"
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="w-full overflow-x-auto">
        <div className="min-w-max">
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="h-[98px] w-full rounded-lg" />
          <div className="h-2" />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <span>Menos</span>
        <div className="flex gap-1">
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[0])} />
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[1])} />
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[2])} />
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[3])} />
          <div className={cn("h-2.5 w-2.5 rounded-sm", intensityColor[4])} />
        </div>
        <span>Más</span>
      </div>
    </div>
  );
}
