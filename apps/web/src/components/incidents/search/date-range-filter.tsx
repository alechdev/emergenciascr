import { CaretDownIcon } from "@phosphor-icons/react";
import {
  endOfDay,
  endOfMonth,
  endOfYear,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears
} from "date-fns";
import { es } from "date-fns/locale";
import { useMemo, useState } from "react";

import {
  DEFAULT_INCIDENTS_RANGE_DAYS,
  getDefaultIncidentsDateRange
} from "@/components/incidents/date-range";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Route } from "@/routes/_incidents/incidentes";

import type { DateRange } from "react-day-picker";

type DatePreset = {
  label: string;
  range: DateRange;
};

function parseSearchDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = parseISO(value);
  if (!isValid(parsed)) {
    return undefined;
  }

  return parsed;
}

function toSelectedRange(
  start?: string,
  end?: string,
  fallbackRange?: DateRange
): DateRange | undefined {
  const from = parseSearchDate(start);
  const to = parseSearchDate(end);

  if (!from && !to) {
    return fallbackRange;
  }

  return {
    from: from ?? to,
    to: to ?? from
  };
}

function toSearchRange(range?: DateRange) {
  const from = range?.from;
  const to = range?.to ?? range?.from;

  return {
    start: from ? startOfDay(from).toISOString() : undefined,
    end: to ? endOfDay(to).toISOString() : undefined
  };
}

function formatDesktopRangeLabel(range: DateRange) {
  const from = range.from;
  const to = range.to ?? range.from;

  if (!from || !to) {
    return "Fechas";
  }

  if (from.getFullYear() !== to.getFullYear()) {
    return `${format(from, "dd/MM/yyyy")} - ${format(to, "dd/MM/yyyy")}`;
  }

  if (from.toDateString() === to.toDateString()) {
    return format(from, "dd 'de' MMMM", { locale: es });
  }

  return `${format(from, "dd 'de' MMMM", { locale: es })} - ${format(to, "dd MMMM", { locale: es })}`;
}

function getDesktopTriggerLabel(start?: string, end?: string) {
  const defaultRange = getDefaultIncidentsDateRange(new Date());
  const selected = toSelectedRange(start, end, defaultRange);
  const from = selected?.from;
  const to = selected?.to;

  if (!from || !to) {
    return "Fechas";
  }

  return formatDesktopRangeLabel(selected);
}

function getPresets(today: Date): DatePreset[] {
  return [
    {
      label: "Hoy",
      range: {
        from: today,
        to: today
      }
    },
    {
      label: "Ayer",
      range: {
        from: subDays(today, 1),
        to: subDays(today, 1)
      }
    },
    {
      label: `Últimos ${DEFAULT_INCIDENTS_RANGE_DAYS} días`,
      range: getDefaultIncidentsDateRange(today)
    },
    {
      label: "Últimos 30 días",
      range: {
        from: subDays(today, 29),
        to: today
      }
    },
    {
      label: "Mes actual",
      range: {
        from: startOfMonth(today),
        to: today
      }
    },
    {
      label: "Mes pasado",
      range: {
        from: startOfMonth(subMonths(today, 1)),
        to: endOfMonth(subMonths(today, 1))
      }
    },
    {
      label: "Año actual",
      range: {
        from: startOfYear(today),
        to: today
      }
    },
    {
      label: "Año pasado",
      range: {
        from: startOfYear(subYears(today, 1)),
        to: endOfYear(subYears(today, 1))
      }
    }
  ];
}

export function DateRangeFilterContent({ className }: { className?: string }) {
  const navigate = Route.useNavigate();
  const { start, end } = Route.useSearch();
  const today = new Date();
  const defaultRange = getDefaultIncidentsDateRange(today);
  const selectedRange = toSelectedRange(start, end, defaultRange);
  const [month, setMonth] = useState<Date>(selectedRange?.to ?? selectedRange?.from ?? today);
  const presets = useMemo(() => getPresets(today), [today]);

  const applyRange = (nextRange?: DateRange) => {
    const nextSearchRange = toSearchRange(nextRange);
    const nextMonth = nextRange?.to ?? nextRange?.from ?? today;

    setMonth(nextMonth);

    void navigate({
      search: (prev) => ({
        ...prev,
        start: nextSearchRange.start,
        end: nextSearchRange.end
      }),
      replace: true,
      resetScroll: false
    });
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="rounded-md border">
        <div className="flex max-md:flex-col">
          <div className="relative py-4 max-md:order-1 max-md:border-t md:w-40">
            <div className="h-full md:border-e">
              <div className="flex flex-col gap-1 px-2">
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    className="w-full justify-start"
                    size="sm"
                    variant="ghost"
                    onClick={() => applyRange(preset.range)}>
                    {preset.label}
                  </Button>
                ))}

                <div className="mt-1 border-t pt-1">
                  <Button
                    className="w-full justify-start"
                    size="sm"
                    variant="ghost"
                    onClick={() => applyRange(undefined)}>
                    Reestablecer
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <Calendar
            className="w-full p-2 md:w-fit"
            disabled={[{ after: today }]}
            mode="range"
            month={month}
            onMonthChange={setMonth}
            onSelect={applyRange}
            selected={selectedRange}
          />
        </div>
      </div>
    </div>
  );
}

export function DateRangeFilterPopover({
  triggerLabel,
  triggerClassName
}: {
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { start, end } = Route.useSearch();
  const label = triggerLabel ?? getDesktopTriggerLabel(start, end);

  return (
    <Popover
      onOpenChange={setOpen}
      open={open}>
      <PopoverTrigger
        render={
          <Button
            className={triggerClassName}
            size="sm"
            variant="outline"
          />
        }>
        <span>{label}</span>
        <CaretDownIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        noPadding
        className="w-fit max-w-[calc(100vw-2rem)] p-0 max-md:w-[calc(100vw-2rem)]"
        positionerClassName="w-fit max-md:w-[calc(100vw-2rem)]"
        sideOffset={8}>
        <DateRangeFilterContent className="w-fit max-md:w-full" />
      </PopoverContent>
    </Popover>
  );
}
