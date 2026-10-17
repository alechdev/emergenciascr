import { type Database, db } from "@bomberoscr/db/index";
import {
  dispatchedStations,
  dispatchedVehicles,
  incidents,
  incidentTypes,
  stations
} from "@bomberoscr/db/schema";
import { startOfCostaRicaMonth } from "@bomberoscr/lib/costa-rica-time";
import {
  INCIDENT_INDEX_MAX_AGE_DAYS,
  INCIDENT_INDEX_MIN_HEAT
} from "@bomberoscr/lib/incident-indexability";
import { and, desc, eq, gte, lt, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { costaRicaMonthKey } from "./costa-rica-time";

const specificIncidentTypes = alias(incidentTypes, "specific_incident_types_sitemap");
const actualIncidentTypes = alias(incidentTypes, "actual_incident_types_sitemap");
const incidentMonth = costaRicaMonthKey(incidents.incidentTimestamp);
const YEAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function vehicleCountsSubquery(database: Database) {
  return database
    .select({
      incidentId: dispatchedVehicles.incidentId,
      vehicleCount: sql<number>`count(*)::int`.as("vehicle_count")
    })
    .from(dispatchedVehicles)
    .groupBy(dispatchedVehicles.incidentId)
    .as("sitemap_vehicle_counts");
}

function stationCountsSubquery(database: Database) {
  return database
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

export async function getSitemapIncidentMonths(database: Database = db) {
  const vehicleCounts = vehicleCountsSubquery(database);
  const stationCounts = stationCountsSubquery(database);

  return await database
    .select({
      month: incidentMonth,
      lastmod: max(incidents.modifiedAt)
    })
    .from(incidents)
    .leftJoin(vehicleCounts, eq(incidents.id, vehicleCounts.incidentId))
    .leftJoin(stationCounts, eq(incidents.id, stationCounts.incidentId))
    .where(indexableIncidentSql(vehicleCounts, stationCounts))
    .groupBy(incidentMonth)
    .orderBy(desc(incidentMonth));
}

/** The incidents reported in a Costa Rica month (`YYYY-MM`). */
export async function getSitemapIncidentsByMonth(yearMonth: string, database: Database = db) {
  const match = YEAR_MONTH_PATTERN.exec(yearMonth);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);

  const vehicleCounts = vehicleCountsSubquery(database);
  const stationCounts = stationCountsSubquery(database);

  return await database
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
        gte(incidents.incidentTimestamp, startOfCostaRicaMonth(year, month)),
        lt(incidents.incidentTimestamp, startOfCostaRicaMonth(year, month + 1)),
        indexableIncidentSql(vehicleCounts, stationCounts)
      )
    )
    .orderBy(desc(incidents.id));
}
