import { type Database, db, count, eq, or, sql } from "@bomberoscr/db/index";
import {
  dispatchedStations,
  dispatchedVehicles,
  incidentTypes,
  incidents,
  stations,
  vehicles
} from "@bomberoscr/db/schema";
import {
  endOfCostaRicaDay,
  formatCostaRicaDate,
  getCostaRicaDateKey,
  getCostaRicaDateParts,
  startOfCostaRicaDay,
  startOfCostaRicaHour,
  startOfCostaRicaYear
} from "@bomberoscr/lib/costa-rica-time";
import { and, desc, gte, lt } from "drizzle-orm";

import {
  costaRicaDayKey,
  costaRicaDayOfWeek,
  costaRicaHourKey,
  costaRicaHourOfDay
} from "./costa-rica-time";

// ============================================================================
// Year Recap
// ============================================================================

export async function getYearRecap(year: number, database: Database = db) {
  const startOfYear = startOfCostaRicaYear(year);
  const endOfYear = startOfCostaRicaYear(year + 1);
  const incidentDay = costaRicaDayKey(incidents.incidentTimestamp);

  const topIncidentDaysResults = await database
    .select({
      date: incidentDay,
      count: sql<number>`count(*)::int`
    })
    .from(incidents)
    .where(
      and(gte(incidents.incidentTimestamp, startOfYear), lt(incidents.incidentTimestamp, endOfYear))
    )
    .groupBy(incidentDay)
    .orderBy(desc(sql`count(*)`), desc(incidentDay))
    .limit(5);

  const topIncidentDays = topIncidentDaysResults.map((item) => ({
    date: item.date,
    count: Number(item.count)
  }));

  const topDispatchedStationsResults = await database
    .select({
      name: stations.name,
      count: sql<number>`count(*)::int`
    })
    .from(stations)
    .innerJoin(dispatchedStations, eq(stations.id, dispatchedStations.stationId))
    .innerJoin(incidents, eq(dispatchedStations.incidentId, incidents.id))
    .where(
      and(gte(incidents.incidentTimestamp, startOfYear), lt(incidents.incidentTimestamp, endOfYear))
    )
    .groupBy(stations.id, stations.name)
    .orderBy(desc(sql`count(*)`), stations.name)
    .limit(5);

  const topDispatchedStations = topDispatchedStationsResults.map((item) => ({
    name: item.name,
    count: Number(item.count)
  }));

  // Per vehicle and the station it served the dispatches for, not its current station: a
  // vehicle that served two stations in the year has a row for each.
  const topDispatchedVehiclesResults = await database
    .select({
      internalNumber: vehicles.internalNumber,
      stationName: stations.name,
      count: sql<number>`count(*)::int`
    })
    .from(dispatchedVehicles)
    .innerJoin(vehicles, eq(dispatchedVehicles.vehicleId, vehicles.id))
    .innerJoin(stations, eq(dispatchedVehicles.stationId, stations.id))
    .innerJoin(incidents, eq(dispatchedVehicles.incidentId, incidents.id))
    .where(
      and(gte(incidents.incidentTimestamp, startOfYear), lt(incidents.incidentTimestamp, endOfYear))
    )
    .groupBy(vehicles.id, vehicles.internalNumber, stations.id, stations.name)
    .orderBy(desc(sql`count(*)`), vehicles.internalNumber, stations.name)
    .limit(5);

  const topDispatchedVehicles = topDispatchedVehiclesResults.map((item) => ({
    internalNumber: item.internalNumber,
    stationName: item.stationName,
    count: Number(item.count)
  }));

  return {
    topIncidentDays,
    topDispatchedStations,
    topDispatchedVehicles
  };
}

// ============================================================================
// Incidents by Type
// ============================================================================

export async function getIncidentsByType({
  startDate,
  endDate,
  limit = 6
}: {
  startDate: Date;
  endDate: Date;
  limit?: number;
}) {
  const incidentTypesBreakdown = await db
    .select({
      code: incidentTypes.incidentCode,
      name: sql<string>`coalesce(${incidentTypes.name}, 'Sin clasificar')`,
      count: sql<number>`count(*)::int`
    })
    .from(incidents)
    .leftJoin(incidentTypes, eq(incidents.specificIncidentCode, incidentTypes.incidentCode))
    .where(sql`${incidents.incidentTimestamp} BETWEEN ${startDate} AND ${endDate}`)
    .groupBy(incidentTypes.incidentCode, incidentTypes.name)
    .orderBy(desc(sql`count(*)`));

  const topTypes = incidentTypesBreakdown.slice(0, limit).map((item) => ({
    code: item.code,
    name: item.name,
    count: Number(item.count)
  }));

  const otherCount = incidentTypesBreakdown
    .slice(limit)
    .reduce((sum, item) => sum + Number(item.count), 0);

  if (otherCount > 0) {
    topTypes.push({
      code: null,
      name: "Otros",
      count: otherCount
    });
  }

  return topTypes;
}

// ============================================================================
// Top Dispatched Stations
// ============================================================================

export async function getTopDispatchedStations({
  startDate,
  endDate
}: {
  startDate: Date;
  endDate: Date;
}) {
  return await db
    .select({
      name: stations.name,
      key: stations.stationKey,
      total: sql<number>`count(*)`,
      responsible: sql<number>`sum(
        case
          when ${incidents.responsibleStation} = ${stations.id} then 1
          else 0
        end
      )`,
      support: sql<number>`sum(
        case
          when ${incidents.responsibleStation} != ${stations.id} then 1
          else 0
        end
      )`
    })
    .from(stations)
    .innerJoin(dispatchedStations, sql`${stations.id} = ${dispatchedStations.stationId}`)
    .innerJoin(incidents, sql`${dispatchedStations.incidentId} = ${incidents.id}`)
    .where(sql`${incidents.incidentTimestamp} BETWEEN ${startDate} AND ${endDate}`)
    .groupBy(stations.id, stations.name)
    .orderBy(sql`count(*) desc`)
    .limit(7);
}

// ============================================================================
// Top Response Times Stations
// ============================================================================

export async function getTopResponseTimesStations({
  startDate,
  endDate
}: {
  startDate: Date;
  endDate: Date;
}) {
  const baseQuery = db
    .select({
      name: stations.name,
      key: stations.stationKey,
      avgResponseTimeMinutes: sql<number>`
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) / 60
          )::numeric, 
          2
        )::float
      `,
      totalDispatches: sql<number>`count(*)::int`,
      fastestResponseMinutes: sql<number>`
        ROUND(
          MIN(
            EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) / 60
          )::numeric, 
          2
        )::float
      `,
      slowestResponseMinutes: sql<number>`
        ROUND(
          MAX(
            EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) / 60
          )::numeric, 
          2
        )::float
      `
    })
    .from(stations)
    .innerJoin(dispatchedVehicles, sql`${stations.id} = ${dispatchedVehicles.stationId}`)
    .innerJoin(incidents, sql`${dispatchedVehicles.incidentId} = ${incidents.id}`)
    .where(sql`
      ${incidents.incidentTimestamp} BETWEEN ${startDate} AND ${endDate}
      AND ${dispatchedVehicles.arrivalTime} IS NOT NULL
      AND ${dispatchedVehicles.dispatchedTime} IS NOT NULL
      AND ${dispatchedVehicles.arrivalTime} > ${dispatchedVehicles.dispatchedTime}
      AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) >= 60
      AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) <= 10800
    `)
    .groupBy(stations.id, stations.name, stations.stationKey)
    .having(sql`count(*) >= 10`);

  const fastestStations = await baseQuery
    .orderBy(sql`
      AVG(
        EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) / 60
      ) ASC
    `)
    .limit(3);

  const slowestStations = await baseQuery
    .orderBy(sql`
      AVG(
        EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) / 60
      ) DESC
    `)
    .limit(3);

  const nationalAverage = await db.execute(sql`
    WITH valid_dispatches AS (
      SELECT 
        ${dispatchedVehicles.stationId},
        EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) / 60 as response_time_minutes
      FROM ${dispatchedVehicles}
      INNER JOIN ${incidents} ON ${dispatchedVehicles.incidentId} = ${incidents.id}
      WHERE ${incidents.incidentTimestamp} BETWEEN ${startDate} AND ${endDate}
        AND ${dispatchedVehicles.arrivalTime} IS NOT NULL
        AND ${dispatchedVehicles.dispatchedTime} IS NOT NULL
        AND ${dispatchedVehicles.arrivalTime} > ${dispatchedVehicles.dispatchedTime}
        AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) >= 60
        AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) <= 10800
    ),
    stations_with_min_incidents AS (
      SELECT "stationId"
      FROM valid_dispatches
      GROUP BY "stationId"
      HAVING count(*) >= 10
    )
    SELECT 
      'Promedio nacional' as name,
      '' as key,
      ROUND(AVG(vd.response_time_minutes), 2)::float as avg_response_time_minutes,
      count(*)::int as total_dispatches,
      ROUND(MIN(vd.response_time_minutes), 2)::float as fastest_response_minutes,
      ROUND(MAX(vd.response_time_minutes), 2)::float as slowest_response_minutes
    FROM valid_dispatches vd
    INNER JOIN stations_with_min_incidents swm ON vd."stationId" = swm."stationId"
  `);

  const avgResult = nationalAverage as unknown as {
    rows: Array<{
      name: string;
      key: string;
      avg_response_time_minutes: number;
      total_dispatches: number;
      fastest_response_minutes: number;
      slowest_response_minutes: number;
    }>;
  };

  const nationalAverageRow = avgResult.rows?.[0];

  return [
    ...fastestStations.map((station) => ({ ...station, category: "fastest" as const })),
    ...slowestStations.map((station) => ({ ...station, category: "slowest" as const })),
    ...(nationalAverageRow
      ? [
          {
            name: nationalAverageRow.name,
            key: nationalAverageRow.key,
            avgResponseTimeMinutes: nationalAverageRow.avg_response_time_minutes,
            totalDispatches: nationalAverageRow.total_dispatches,
            fastestResponseMinutes: nationalAverageRow.fastest_response_minutes,
            slowestResponseMinutes: nationalAverageRow.slowest_response_minutes,
            category: "average" as const
          }
        ]
      : [])
  ];
}

// ============================================================================
// Incidents by Day of Week
// ============================================================================

export async function getIncidentsByDayOfWeek(
  {
    startDate,
    endDate
  }: {
    startDate: Date;
    endDate: Date;
  },
  database: Database = db
) {
  const dayOfWeekOrder = {
    Lunes: 0,
    Martes: 1,
    Miércoles: 2,
    Jueves: 3,
    Viernes: 4,
    Sábado: 5,
    Domingo: 6
  };

  const dayOfWeek = costaRicaDayOfWeek(incidents.incidentTimestamp);
  const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

  const rows = await database
    .select({
      dayOfWeek,
      count: sql<number>`count(*)::int`
    })
    .from(incidents)
    .where(sql`${incidents.incidentTimestamp} BETWEEN ${startDate} AND ${endDate}`)
    .groupBy(dayOfWeek);
  const results = rows.map((row) => ({ dayOfWeek: dayNames[row.dayOfWeek], count: row.count }));

  const sortedResults = Object.entries(dayOfWeekOrder)
    .map(([dayName, order]) => {
      const existing = results.find((r) => r.dayOfWeek === dayName);
      return {
        dayOfWeek: dayName,
        count: existing?.count || 0,
        order
      };
    })
    .sort((a, b) => a.order - b.order);

  return sortedResults.map(({ dayOfWeek, count }) => ({
    dayOfWeek,
    count
  }));
}

// ============================================================================
// Incidents by Hour
// ============================================================================

const HOUR_IN_MS = 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export async function getIncidentsByHourRange(
  {
    startDate,
    endDate
  }: {
    startDate: Date;
    endDate: Date;
  },
  database: Database = db
) {
  const hourBucket = costaRicaHourKey(incidents.incidentTimestamp);
  const groupedByHour = await database
    .select({
      hourBucket,
      incidents: sql<number>`count(*)::int`
    })
    .from(incidents)
    .where(
      and(gte(incidents.incidentTimestamp, startDate), lt(incidents.incidentTimestamp, endDate))
    )
    .groupBy(hourBucket)
    .orderBy(hourBucket);

  const incidentsByHourBucket = new Map(
    groupedByHour.map((row) => [row.hourBucket, Number(row.incidents)])
  );

  const firstHourMs = startOfCostaRicaHour(startDate).getTime();
  const lastHourMs = startOfCostaRicaHour(endDate).getTime();
  const totalBuckets = Math.max(0, Math.floor((lastHourMs - firstHourMs) / HOUR_IN_MS) + 1);

  return Array.from({ length: totalBuckets }, (_, index) => {
    const hourStart = new Date(firstHourMs + index * HOUR_IN_MS);
    const { hour } = getCostaRicaDateParts(hourStart);
    const hourBucketKey = `${getCostaRicaDateKey(hourStart)} ${pad(hour)}:00:00`;

    return {
      hourStart: hourStart.toISOString(),
      hourLabel: `${pad(hour)}:00`,
      hoursAgo: totalBuckets - index - 1,
      incidents: incidentsByHourBucket.get(hourBucketKey) ?? 0
    };
  });
}

export async function getIncidentsByHour(
  {
    startDate,
    endDate
  }: {
    startDate: Date;
    endDate: Date;
  },
  database: Database = db
) {
  const hourOfDay = costaRicaHourOfDay(incidents.incidentTimestamp);
  const results = await database
    .select({
      hour: hourOfDay,
      count: sql<number>`count(*)::int`
    })
    .from(incidents)
    .where(sql`${incidents.incidentTimestamp} BETWEEN ${startDate} AND ${endDate}`)
    .groupBy(hourOfDay)
    .orderBy(hourOfDay);

  const allHours = Array.from({ length: 24 }, (_, i) => i);
  const hourMap = new Map(results.map((r) => [r.hour, r.count]));

  return allHours.map((hour) => ({
    hour,
    count: hourMap.get(hour) || 0,
    displayHour: `${hour.toString().padStart(2, "0")}:00`
  }));
}

// ============================================================================
// Daily Incidents
// ============================================================================

export async function getDailyIncidents(
  {
    startDate,
    endDate
  }: {
    startDate: Date;
    endDate: Date;
  },
  database: Database = db
) {
  // Whole Costa Rica days, and the same number of days just before.
  const currentStartDate = startOfCostaRicaDay(startDate);
  const currentEndDate = endOfCostaRicaDay(endDate);
  const firstDayKey = getCostaRicaDateKey(currentStartDate);
  const lastDayKey = getCostaRicaDateKey(currentEndDate);

  const dayKeys: string[] = [];
  for (
    let key = firstDayKey;
    key <= lastDayKey;
    key = getCostaRicaDateKey(startOfCostaRicaDay(key, 1))
  ) {
    dayKeys.push(key);
  }
  const timeRange = dayKeys.length;
  const previousDayKeys = dayKeys.map((_, index) =>
    getCostaRicaDateKey(startOfCostaRicaDay(firstDayKey, index - timeRange))
  );
  const previousStartDate = startOfCostaRicaDay(firstDayKey, -timeRange);
  const previousEndDate = new Date(currentStartDate.getTime() - 1);

  const incidentDay = costaRicaDayKey(incidents.incidentTimestamp);

  const currentPeriod = await database
    .select({
      date: incidentDay,
      count: sql<number>`count(*)::int`
    })
    .from(incidents)
    .where(sql`${incidents.incidentTimestamp} BETWEEN ${currentStartDate} AND ${currentEndDate}`)
    .groupBy(incidentDay)
    .orderBy(incidentDay);

  const previousPeriod = await database
    .select({
      date: incidentDay,
      count: sql<number>`count(*)::int`
    })
    .from(incidents)
    .where(sql`${incidents.incidentTimestamp} BETWEEN ${previousStartDate} AND ${previousEndDate}`)
    .groupBy(incidentDay)
    .orderBy(incidentDay);

  const fillMissingDates = (data: typeof currentPeriod, keys: string[]) => {
    const counts = new Map(data.map((row) => [row.date, Number(row.count)]));
    return keys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
  };

  const currentData = fillMissingDates(currentPeriod, dayKeys);
  const previousData = fillMissingDates(previousPeriod, previousDayKeys);

  const combinedData = currentData.map((current, index) => {
    const previous = previousData[index];
    const dayOffset = index + 1;

    return {
      date: current.date,
      dayOffset,
      current: current.count,
      previous: previous?.count || 0,
      displayDate: current.date
        ? formatCostaRicaDate(startOfCostaRicaDay(current.date), "dayMonth")
        : ""
    };
  });

  const currentTotal = currentData.reduce((sum, item) => sum + Number(item.count), 0);
  const previousTotal = previousData.reduce((sum, item) => sum + Number(item.count), 0);
  const percentageChange =
    previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;

  return {
    data: combinedData,
    summary: {
      currentTotal,
      previousTotal,
      percentageChange
    }
  };
}

// ============================================================================
// Daily Response Times
// ============================================================================

export async function getDailyResponseTimes(
  {
    startDate,
    endDate
  }: {
    startDate: Date;
    endDate: Date;
  },
  database: Database = db
) {
  const incidentDay = costaRicaDayKey(incidents.incidentTimestamp);
  return await database
    .select({
      date: incidentDay,
      averageResponseTimeSeconds: sql<number>`
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime}))
          )::numeric,
          0
        )::int
      `,
      dispatchCount: sql<number>`count(*)::int`
    })
    .from(dispatchedVehicles)
    .innerJoin(incidents, eq(dispatchedVehicles.incidentId, incidents.id))
    .where(sql`
      ${incidents.incidentTimestamp} BETWEEN ${startDate} AND ${endDate}
      AND ${dispatchedVehicles.arrivalTime} IS NOT NULL
      AND ${dispatchedVehicles.dispatchedTime} IS NOT NULL
      AND ${dispatchedVehicles.arrivalTime} > ${dispatchedVehicles.dispatchedTime}
      AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) >= 60
      AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) <= 10800
    `)
    .groupBy(incidentDay)
    .orderBy(incidentDay);
}

// ============================================================================
// System Overview
// ============================================================================

export async function getSystemOverview() {
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = new Date();

  const [stationCount, activeVehicleCount, avgResponseTimeResult] = await Promise.all([
    db.select({ count: count() }).from(stations).where(eq(stations.isOperative, true)),

    db
      .select({ count: count() })
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
          EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) / 60 as response_time_minutes
        FROM ${dispatchedVehicles}
        INNER JOIN ${incidents} ON ${dispatchedVehicles.incidentId} = ${incidents.id}
        WHERE ${incidents.incidentTimestamp} BETWEEN ${startDate} AND ${endDate}
          AND ${dispatchedVehicles.arrivalTime} IS NOT NULL
          AND ${dispatchedVehicles.dispatchedTime} IS NOT NULL
          AND ${dispatchedVehicles.arrivalTime} > ${dispatchedVehicles.dispatchedTime}
          AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) >= 60
          AND EXTRACT(EPOCH FROM (${dispatchedVehicles.arrivalTime} - ${dispatchedVehicles.dispatchedTime})) <= 10800
      ),
      stations_with_min_incidents AS (
        SELECT "stationId"
        FROM valid_dispatches
        GROUP BY "stationId"
        HAVING count(*) >= 10
      )
      SELECT 
        ROUND(AVG(vd.response_time_minutes), 2)::float as avg_response_time_minutes
      FROM valid_dispatches vd
      INNER JOIN stations_with_min_incidents swm ON vd."stationId" = swm."stationId"
    `)
  ]);

  const avgResult = avgResponseTimeResult as unknown as {
    rows: [{ avg_response_time_minutes: number | null }];
  };

  return {
    stationCount: stationCount[0]?.count ?? 0,
    activeVehicleCount: activeVehicleCount[0]?.count ?? 0,
    avgResponseTimeMinutes: avgResult.rows?.[0]?.avg_response_time_minutes ?? null
  };
}
