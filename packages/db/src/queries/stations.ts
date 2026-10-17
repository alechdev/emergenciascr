import { type Database, db } from "@bomberoscr/db/index";
import {
  dispatchedStations,
  dispatchedVehicles,
  incidents,
  stations,
  vehicles
} from "@bomberoscr/db/schema";
import { DEFAULT_TIME_RANGE } from "@bomberoscr/lib/time-range";
import { and, asc, between, count, desc, eq, gte, ilike, lte, ne, or, sql } from "drizzle-orm";

import type { SQL } from "drizzle-orm";

type StationFilters = {
  q?: string | null;
  operative?: boolean | null;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
};

const stationKeyPrimarySort = sql<number>`
  CASE
    WHEN ${stations.stationKey} ~ '^[0-9]+-[0-9]+$'
      THEN CAST(SPLIT_PART(${stations.stationKey}, '-', 1) AS INTEGER)
    ELSE NULL
  END
`;
const stationKeySecondarySort = sql<number>`
  CASE
    WHEN ${stations.stationKey} ~ '^[0-9]+-[0-9]+$'
      THEN CAST(SPLIT_PART(${stations.stationKey}, '-', 2) AS INTEGER)
    ELSE NULL
  END
`;

function buildStationWhereClause(filters: StationFilters) {
  const conditions: SQL[] = [];

  if (typeof filters.operative === "boolean") {
    conditions.push(eq(stations.isOperative, filters.operative));
  }

  const searchTerm = filters.q?.trim();
  if (searchTerm) {
    const searchCondition = or(
      ilike(stations.name, `%${searchTerm}%`),
      ilike(stations.stationKey, `%${searchTerm}%`)
    );
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  if (filters.bounds) {
    const boundsCondition = and(
      gte(stations.latitude, String(filters.bounds.south)),
      lte(stations.latitude, String(filters.bounds.north)),
      gte(stations.longitude, String(filters.bounds.west)),
      lte(stations.longitude, String(filters.bounds.east))
    );
    if (boundsCondition) {
      conditions.push(boundsCondition);
    }
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

export type StationsListParams = {
  limit: number;
  page: number;
  sort: string[];
  q?: string | null;
  operative?: boolean | null;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
};

export async function getStationsList(params: StationsListParams) {
  const { limit, page, sort, q, operative, bounds } = params;
  const offset = (page - 1) * limit;
  const whereClause = buildStationWhereClause({ q, operative, bounds });

  const [rows, countRows] = await Promise.all([
    (() => {
      const query = db
        .select({
          id: stations.id,
          name: stations.name,
          stationKey: stations.stationKey,
          radioChannel: stations.radioChannel,
          latitude: stations.latitude,
          longitude: stations.longitude,
          address: stations.address,
          phoneNumber: stations.phoneNumber,
          fax: stations.fax,
          email: stations.email,
          isOperative: stations.isOperative
        })
        .from(stations)
        .where(whereClause);

      if (sort && sort.length === 2) {
        const [column, direction] = sort;
        const isAscending = direction === "asc";

        switch (column) {
          case "id":
            query.orderBy(isAscending ? asc(stations.id) : desc(stations.id));
            break;
          case "name":
            query.orderBy(isAscending ? asc(stations.name) : desc(stations.name));
            break;
          case "stationKey":
            query.orderBy(
              isAscending ? asc(stationKeyPrimarySort) : desc(stationKeyPrimarySort),
              isAscending ? asc(stationKeySecondarySort) : desc(stationKeySecondarySort),
              isAscending ? asc(stations.stationKey) : desc(stations.stationKey)
            );
            break;
          default:
            query.orderBy(
              asc(stationKeyPrimarySort),
              asc(stationKeySecondarySort),
              asc(stations.stationKey)
            );
        }
      } else {
        query.orderBy(
          asc(stationKeyPrimarySort),
          asc(stationKeySecondarySort),
          asc(stations.stationKey)
        );
      }

      return query.limit(limit).offset(offset);
    })(),
    db.select({ count: count() }).from(stations).where(whereClause)
  ]);

  const total = countRows[0]?.count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return {
    data: rows,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  };
}

export async function getStationIdByName({ name }: { name: string }) {
  const normalizedName = name.trim().toUpperCase();
  return (
    (await db.query.stations.findFirst({
      where: eq(sql`UPPER(TRIM(${stations.name}))`, normalizedName),
      columns: {
        id: true,
        name: true,
        stationKey: true,
        isOperative: true
      }
    })) ?? null
  );
}

export async function getStationByName({ name }: { name: string }) {
  const normalizedName = name.trim().toUpperCase();
  return (
    (await db.query.stations.findFirst({
      where: eq(sql`UPPER(TRIM(${stations.name}))`, normalizedName)
    })) ?? null
  );
}

export async function getStationIncidentsPerDay({
  stationId,
  days = 365
}: {
  stationId: number;
  days?: number;
}) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return await db
    .select({
      date: sql<string>`date_trunc('day', ${incidents.incidentTimestamp} - interval '6 hours')::date::text`,
      count: sql<number>`count(*)::int`
    })
    .from(dispatchedStations)
    .innerJoin(incidents, eq(dispatchedStations.incidentId, incidents.id))
    .where(
      and(eq(dispatchedStations.stationId, stationId), gte(incidents.incidentTimestamp, cutoffDate))
    )
    .groupBy(sql`date_trunc('day', ${incidents.incidentTimestamp} - interval '6 hours')`);
}

export async function getStationHighlightedIncidents({
  stationId,
  timeRange = DEFAULT_TIME_RANGE,
  limit = 6
}: {
  stationId: number;
  timeRange?: number;
  limit?: number;
}) {
  const startDate = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);
  const endDate = new Date();

  const vehicleCounts = db
    .select({
      incidentId: dispatchedVehicles.incidentId,
      vehicleCount: sql<number>`count(*)::int`.as("vehicle_count")
    })
    .from(dispatchedVehicles)
    .groupBy(dispatchedVehicles.incidentId)
    .as("vehicle_counts");

  const stationCounts = db
    .select({
      incidentId: dispatchedStations.incidentId,
      stationCount: sql<number>`count(*)::int`.as("station_count")
    })
    .from(dispatchedStations)
    .groupBy(dispatchedStations.incidentId)
    .as("station_counts");

  const dispatchedToStation = db
    .selectDistinct({ incidentId: dispatchedStations.incidentId })
    .from(dispatchedStations)
    .where(eq(dispatchedStations.stationId, stationId))
    .as("dispatched_to_station");

  return await db
    .select({
      id: incidents.id,
      incidentTimestamp: incidents.incidentTimestamp,
      details: incidents.importantDetails,
      address: incidents.address,
      responsibleStation: stations.name,
      latitude: incidents.latitude,
      longitude: incidents.longitude,
      dispatchedVehiclesCount: sql<number>`COALESCE(${vehicleCounts.vehicleCount}, 0)`,
      dispatchedStationsCount: sql<number>`COALESCE(${stationCounts.stationCount}, 0)`
    })
    .from(incidents)
    .innerJoin(dispatchedToStation, eq(incidents.id, dispatchedToStation.incidentId))
    .leftJoin(stations, eq(incidents.responsibleStation, stations.id))
    .leftJoin(vehicleCounts, eq(incidents.id, vehicleCounts.incidentId))
    .leftJoin(stationCounts, eq(incidents.id, stationCounts.incidentId))
    .where(between(incidents.incidentTimestamp, startDate, endDate))
    .orderBy(
      desc(
        sql`COALESCE(${vehicleCounts.vehicleCount}, 0) + COALESCE(${stationCounts.stationCount}, 0)`
      )
    )
    .limit(limit);
}

export async function getStationCollaborations({ stationId }: { stationId: number }) {
  const stationIncidents = db
    .selectDistinct({
      incidentId: dispatchedStations.incidentId
    })
    .from(dispatchedStations)
    .innerJoin(incidents, eq(dispatchedStations.incidentId, incidents.id))
    .where(eq(dispatchedStations.stationId, stationId))
    .as("station_incidents");

  return await db
    .select({
      id: stations.id,
      name: stations.name,
      stationKey: stations.stationKey,
      collaborationCount: sql<number>`count(*)::int`.as("collaboration_count")
    })
    .from(dispatchedStations)
    .innerJoin(stationIncidents, eq(dispatchedStations.incidentId, stationIncidents.incidentId))
    .innerJoin(stations, eq(dispatchedStations.stationId, stations.id))
    .innerJoin(incidents, eq(dispatchedStations.incidentId, incidents.id))
    .where(ne(dispatchedStations.stationId, stationId))
    .groupBy(stations.id, stations.name, stations.stationKey)
    .orderBy(desc(sql`count(*)`))
    .limit(6);
}

/**
 * The vehicles currently assigned to a station, with the dispatches they served for it in the
 * last 30 days: a vehicle moved from another station doesn't bring that station's dispatches.
 */
export async function getStationVehiclesWithStats(
  { stationId, now = new Date() }: { stationId: number; now?: Date },
  database: Database = db
) {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const stationDispatches = database
    .select({
      id: dispatchedVehicles.id,
      vehicleId: dispatchedVehicles.vehicleId,
      dispatchedTime: dispatchedVehicles.dispatchedTime,
      arrivalTime: dispatchedVehicles.arrivalTime
    })
    .from(dispatchedVehicles)
    .innerJoin(incidents, eq(dispatchedVehicles.incidentId, incidents.id))
    .where(
      and(
        eq(dispatchedVehicles.stationId, stationId),
        gte(incidents.incidentTimestamp, thirtyDaysAgo)
      )
    )
    .as("station_dispatches");

  const results = await database
    .select({
      id: vehicles.id,
      internalNumber: vehicles.internalNumber,
      plate: vehicles.plate,
      descriptionType: vehicles.descriptionType,
      class: vehicles.class,
      descriptionOperationalStatus: vehicles.descriptionOperationalStatus,
      incidentCount: sql<number>`count(${stationDispatches.id})::int`.as("incident_count"),
      avgResponseTimeSeconds: sql<number | null>`
        round(avg(
          CASE 
            WHEN ${stationDispatches.arrivalTime} > ${stationDispatches.dispatchedTime}
              AND extract(epoch from (${stationDispatches.arrivalTime} - ${stationDispatches.dispatchedTime})) >= 60
              AND extract(epoch from (${stationDispatches.arrivalTime} - ${stationDispatches.dispatchedTime})) <= 10800
            THEN extract(epoch from (${stationDispatches.arrivalTime} - ${stationDispatches.dispatchedTime}))
            ELSE NULL 
          END
        ))::int
      `.as("avg_response_time_seconds")
    })
    .from(vehicles)
    .leftJoin(stationDispatches, eq(stationDispatches.vehicleId, vehicles.id))
    .where(eq(vehicles.stationId, stationId))
    .groupBy(vehicles.id)
    .orderBy(desc(sql`count(${stationDispatches.id})`), asc(vehicles.id));

  return results.map((row) => ({
    id: row.id,
    internalNumber: row.internalNumber,
    plate: row.plate,
    descriptionType: row.descriptionType,
    class: row.class,
    descriptionOperationalStatus: row.descriptionOperationalStatus,
    stats: {
      incidentCount: row.incidentCount ?? 0,
      avgResponseTimeSeconds: row.avgResponseTimeSeconds
    }
  }));
}

export async function getStationsOverview() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const [operativeStationsResult, operativeVehiclesResult, avgResponseTimeResult] =
    await Promise.all([
      db
        .select({
          count: sql<number>`count(*)::int`
        })
        .from(stations)
        .where(eq(stations.isOperative, true)),

      db
        .select({
          count: sql<number>`count(*)::int`
        })
        .from(vehicles)
        .where(
          or(
            eq(vehicles.descriptionOperationalStatus, "DISPONIBLE"),
            eq(vehicles.descriptionOperationalStatus, "EN INCIDENTE")
          )
        ),

      db.execute(sql`
      WITH valid_dispatches AS (
        SELECT 
          ${dispatchedVehicles.stationId},
          EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) as response_time
        FROM ${dispatchedVehicles}
        INNER JOIN ${incidents} ON ${dispatchedVehicles.incidentId} = ${incidents.id}
        WHERE ${incidents.incidentTimestamp} BETWEEN ${thirtyDaysAgo} AND ${now}
          AND ${dispatchedVehicles.arrivalTime} IS NOT NULL
          AND ${dispatchedVehicles.dispatchedTime} IS NOT NULL
          AND ${dispatchedVehicles.arrivalTime} > ${dispatchedVehicles.dispatchedTime}
          AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) >= 60
          AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) <= 10800
      ),
      stations_with_min_incidents AS (
        SELECT station_id
        FROM valid_dispatches
        GROUP BY station_id
        HAVING count(*) >= 10
      )
      SELECT 
        ROUND(AVG(vd.response_time))::int as avg_response_time_seconds
      FROM valid_dispatches vd
      INNER JOIN stations_with_min_incidents swm ON vd.station_id = swm.station_id
    `)
    ]);

  const avgResult = avgResponseTimeResult as unknown as {
    rows: [{ avg_response_time_seconds: number | null }];
  };

  return {
    operativeStationsCount: operativeStationsResult[0]?.count ?? 0,
    operativeVehiclesCount: operativeVehiclesResult[0]?.count ?? 0,
    averageResponseTimeSeconds: avgResult.rows?.[0]?.avg_response_time_seconds ?? null
  };
}
