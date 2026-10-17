import { and, between, db, desc, inArray, or, sql } from "@bomberoscr/db/index";
import { dispatchedStations, incidents } from "@bomberoscr/db/schema";
import { endOfCostaRicaDay, startOfCostaRicaDay } from "@bomberoscr/lib/costa-rica-time";
import { type SQL, ilike } from "drizzle-orm";

export type SearchBounds = {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
};

export type SearchFilters = {
  incidentTypeCodes?: string[];
  stationIds?: number[];
  start?: Date;
  end?: Date;
  limit?: number;
  bounds?: SearchBounds;
};

export type SearchIncidentCoordinate = {
  id: number;
  latitude: string;
  longitude: string;
};

export async function searchIncidentsCoordinates(
  filters: SearchFilters
): Promise<SearchIncidentCoordinate[]> {
  const whereClauses: SQL<unknown>[] = [];

  whereClauses.push(sql`${incidents.latitude} <> 0`);

  if (filters.start && filters.end) {
    // Whole Costa Rica days, whatever the server's time zone.
    const start = startOfCostaRicaDay(filters.start);
    const end = endOfCostaRicaDay(filters.end);
    whereClauses.push(between(incidents.incidentTimestamp, start, end));
  }

  if (filters.incidentTypeCodes && filters.incidentTypeCodes.length > 0) {
    for (const code of filters.incidentTypeCodes) {
      whereClauses.push(ilike(incidents.specificIncidentCode, code));
    }
  }

  if (filters.stationIds && filters.stationIds.length > 0) {
    const dispatched = await db
      .select({ incidentId: dispatchedStations.incidentId })
      .from(dispatchedStations)
      .where(inArray(dispatchedStations.stationId, filters.stationIds));

    const dispatchedIncidentIds = dispatched.map((d) => d.incidentId).filter((id) => id != null);

    const clauses: SQL<unknown>[] = [];
    if (filters.stationIds.length > 0) {
      clauses.push(inArray(incidents.responsibleStation, filters.stationIds));
    }
    if (dispatchedIncidentIds.length > 0) {
      clauses.push(inArray(incidents.id, dispatchedIncidentIds));
    }

    if (clauses.length > 0) {
      whereClauses.push(or(...(clauses as SQL<unknown>[])) as SQL<unknown>);
    }
  }

  if (filters.bounds) {
    const { minLat, maxLat, minLng, maxLng } = filters.bounds;
    whereClauses.push(
      between(incidents.latitude, sql`${minLat}::numeric`, sql`${maxLat}::numeric`)
    );
    whereClauses.push(
      between(incidents.longitude, sql`${minLng}::numeric`, sql`${maxLng}::numeric`)
    );
  }

  const whereExpr: SQL<unknown> | undefined =
    whereClauses.length > 0 ? and(...whereClauses) : undefined;

  const rows = await db.query.incidents.findMany({
    columns: {
      id: true,
      latitude: true,
      longitude: true
    },
    where: whereExpr,
    orderBy: desc(incidents.id),
    limit: filters.limit ?? 500
  });

  return rows.map((r) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude }));
}
