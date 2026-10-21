import {
  calendarDateFromKey,
  endOfCostaRicaDay,
  getCalendarDateKey,
  getCostaRicaCalendarToday,
  getCostaRicaDateKey,
  startOfCostaRicaDay
} from "@bomberoscr/lib/costa-rica-time";
import { subDays } from "date-fns";

export const DEFAULT_INCIDENTS_RANGE_DAYS = 7;

/**
 * The date filter works with calendar days (local `Date`s at midnight, what the date picker and
 * date-fns use) and searches with instants: a range of days runs from Costa Rica midnight on the
 * first one to the last millisecond of the last one, whatever the browser's time zone.
 */
export function getDefaultIncidentsDateRange(today: Date = getCostaRicaCalendarToday()) {
  return {
    from: subDays(today, DEFAULT_INCIDENTS_RANGE_DAYS - 1),
    to: today
  };
}

export function getDefaultIncidentsSearchRange(now: Date = new Date()) {
  const { from, to } = getDefaultIncidentsDateRange(getCostaRicaCalendarToday(now));
  return toIncidentsSearchRange(from, to);
}

/** The instants searched for a range of calendar days. */
export function toIncidentsSearchRange(from: Date, to: Date): { start: string; end: string } {
  return {
    start: startOfCostaRicaDay(getCalendarDateKey(from)).toISOString(),
    end: endOfCostaRicaDay(getCalendarDateKey(to)).toISOString()
  };
}

/** The Costa Rica calendar day of a searched instant (`start` or `end`), for the date picker. */
export function fromIncidentsSearchDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return undefined;
  return calendarDateFromKey(getCostaRicaDateKey(instant)) ?? undefined;
}
