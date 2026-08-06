import { endOfDay, startOfDay, subDays } from "date-fns";

export const DEFAULT_INCIDENTS_RANGE_DAYS = 7;

export function getDefaultIncidentsDateRange(today: Date = new Date()) {
  return {
    from: subDays(today, DEFAULT_INCIDENTS_RANGE_DAYS - 1),
    to: today
  };
}

export function getDefaultIncidentsSearchRange(today: Date = new Date()) {
  const { from, to } = getDefaultIncidentsDateRange(today);

  return {
    start: startOfDay(from).toISOString(),
    end: endOfDay(to).toISOString()
  };
}
