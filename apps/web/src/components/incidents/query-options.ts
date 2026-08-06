import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getDefaultIncidentsSearchRange } from "@/components/incidents/date-range";
import { listIncidentsOptions } from "@/lib/api/@tanstack/react-query.gen";

const INCIDENTS_PAGE_SIZE = 100;

type IncidentsSort = "newest" | "oldest" | "most-dispatched" | "least-dispatched";
type ListIncidentsQuery = NonNullable<
  NonNullable<Parameters<typeof listIncidentsOptions>[0]>["query"]
>;

export type IncidentsSearchParams = {
  q?: string;
  sort?: IncidentsSort;
  start?: string;
  end?: string;
  stations?: string[];
  incidentCodes?: string[];
  open?: boolean;
  northBound?: number;
  southBound?: number;
  eastBound?: number;
  westBound?: number;
};

function sortToTuple(sort: IncidentsSort | undefined): [string, string] {
  switch (sort) {
    case "oldest":
      return ["id", "asc"];
    case "most-dispatched":
      return ["totalDispatched", "desc"];
    case "least-dispatched":
      return ["totalDispatched", "asc"];
    case "newest":
    default:
      return ["id", "desc"];
  }
}

export function getIncidentsQueryOptions(search: IncidentsSearchParams) {
  const stationIds = (search.stations ?? [])
    .map((stationId) => Number.parseInt(stationId, 10))
    .filter((stationId) => !Number.isNaN(stationId));

  const hasBounds =
    search.northBound != null &&
    search.southBound != null &&
    search.eastBound != null &&
    search.westBound != null;

  const useDefaultDateRange = search.start == null && search.end == null;
  const defaultDateRange = useDefaultDateRange ? getDefaultIncidentsSearchRange() : undefined;

  const query: ListIncidentsQuery = {
    pageSize: INCIDENTS_PAGE_SIZE,
    sort: sortToTuple(search.sort),
    q: search.q,
    start: defaultDateRange?.start ?? search.start,
    end: defaultDateRange?.end ?? search.end,
    stations: stationIds.length > 0 ? stationIds : undefined,
    types:
      search.incidentCodes && search.incidentCodes.length > 0 ? search.incidentCodes : undefined,
    open: search.open == null ? undefined : String(search.open),
    bounds: hasBounds
      ? {
          north: search.northBound as number,
          south: search.southBound as number,
          east: search.eastBound as number,
          west: search.westBound as number
        }
      : undefined
  };

  return listIncidentsOptions({
    query
  });
}

export function useIncidentsQuery(search: IncidentsSearchParams) {
  return useQuery({
    ...getIncidentsQueryOptions(search),
    placeholderData: keepPreviousData
  });
}
