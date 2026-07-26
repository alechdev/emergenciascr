import { db } from "@bomberoscr/db/index";
import {
  dispatchedStations,
  dispatchedVehicles,
  incidents,
  incidentTypes,
  stations
} from "@bomberoscr/db/schema";
import {
  INCIDENT_INDEX_MAX_AGE_DAYS,
  INCIDENT_INDEX_MIN_HEAT
} from "@bomberoscr/lib/incident-indexability";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

const specificIncidentTypes = alias(incidentTypes, "specific_incident_types_sitemap");
const actualIncidentTypes = alias(incidentTypes, "actual_incident_types_sitemap");
const incidentMonthBucket = sql`date_trunc('month', ${incidents.incidentTimestamp})`;

function vehicleCountsSubquery() {
  return db
    .select({
      incidentId: dispatchedVehicles.incidentId,
      vehicleCount: sql<number>`count(*)::int`.as("vehicle_count")
    })
    .from(dispatchedVehicles)
    .groupBy(dispatchedVehicles.incidentId)
    .as("sitemap_vehicle_counts");
}

function stationCountsSubquery() {
  return db
    .select({
      incidentId: dispatchedStations.incidentId,
      stationCount: sql<number>`count(*)::int`.as("station_count")
    })
    .from(dispatchedStations)
    .groupBy(dispatchedStations.incidentId)
    .as("sitemap_station_counts");
}

/** open OR age ≤ 7d OR stations+vehicles ≥ 5 — keep in sync with isIncidentIndexable */
function indexableIncidentSql(
  vehicleCounts: ReturnType<typeof vehicleCountsSubquery>,
  stationCounts: ReturnType<typeof stationCountsSubquery>
) {
  return sql`(
    ${incidents.isOpen} = true
    OR ${incidents.incidentTimestamp} >= (now() - make_interval(days => ${INCIDENT_INDEX_MAX_AGE_DAYS}))
    OR (
      COALESCE(${stationCounts.stationCount}, 0) + COALESCE(${vehicleCounts.vehicleCount}, 0)
    ) >= ${INCIDENT_INDEX_MIN_HEAT}
  )`;
}

export async function getSitemapStations() {
  return await db
    .select({
      name: stations.name
    })
    .from(stations)
    .orderBy(stations.name);
}

export async function getSitemapIncidentMonths() {
  const vehicleCounts = vehicleCountsSubquery();
  const stationCounts = stationCountsSubquery();

  return await db
    .select({
      month: sql<string>`to_char(${incidentMonthBucket}, 'YYYY-MM')`,
      lastmod: max(incidents.modifiedAt)
    })
    .from(incidents)
    .leftJoin(vehicleCounts, eq(incidents.id, vehicleCounts.incidentId))
    .leftJoin(stationCounts, eq(incidents.id, stationCounts.incidentId))
    .where(indexableIncidentSql(vehicleCounts, stationCounts))
    .groupBy(incidentMonthBucket)
    .orderBy(desc(incidentMonthBucket));
}

export async function getSitemapIncidentsByMonth(yearMonth: string) {
  const vehicleCounts = vehicleCountsSubquery();
  const stationCounts = stationCountsSubquery();

  return await db
    .select({
      id: incidents.id,
      incidentTimestamp: incidents.incidentTimestamp,
      modifiedAt: incidents.modifiedAt,
      importantDetails: incidents.importantDetails,
      specificIncidentType: specificIncidentTypes.name,
      incidentType: actualIncidentTypes.name
    })
    .from(incidents)
    .leftJoin(
      specificIncidentTypes,
      eq(incidents.specificIncidentCode, specificIncidentTypes.incidentCode)
    )
    .leftJoin(actualIncidentTypes, eq(incidents.incidentCode, actualIncidentTypes.incidentCode))
    .leftJoin(vehicleCounts, eq(incidents.id, vehicleCounts.incidentId))
    .leftJoin(stationCounts, eq(incidents.id, stationCounts.incidentId))
    .where(
      and(
        sql`to_char(${incidentMonthBucket}, 'YYYY-MM') = ${yearMonth}`,
        indexableIncidentSql(vehicleCounts, stationCounts)
      )
    )
    .orderBy(desc(incidents.id));
}
