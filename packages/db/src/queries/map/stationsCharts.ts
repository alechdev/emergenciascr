import { db } from "@bomberoscr/db/index";
import { dispatchedStations, incidentTypes, incidents, stations } from "@bomberoscr/db/schema";
import { getCostaRicaDateKey, startOfCostaRicaDay } from "@bomberoscr/lib/costa-rica-time";
import { and, between, eq, inArray, isNull, not, sql } from "drizzle-orm";

import { costaRicaDayKey, costaRicaHourOfDay } from "../costa-rica-time";

/** Every Costa Rica day from `startDate` to `endDate`, each starting at Costa Rica midnight. */
function fillMissingDates(data: { day: string; count: number }[], startDate: Date, endDate: Date) {
  const filledData: { day: Date; count: number }[] = [];
  const existingDates = new Map(data.map((item) => [item.day, Number(item.count)]));
  const lastKey = getCostaRicaDateKey(endDate);

  for (let day = startOfCostaRicaDay(startDate); ; day = startOfCostaRicaDay(day, 1)) {
    const dateKey = getCostaRicaDateKey(day);
    if (dateKey > lastKey) break;
    filledData.push({ day, count: existingDates.get(dateKey) || 0 });
  }

  return filledData;
}

export async function getStationStats(key: string) {
  const now = new Date();
  const [weekIncidents, monthIncidents] = await Promise.all([
    getStationIncidentsGroupedByCostaRicaDay(key),
    getStationIncidentsGroupedByCostaRicaDay30Days(key)
  ]);

  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    week: fillMissingDates(weekIncidents as { day: string; count: number }[], weekStart, now),
    month: fillMissingDates(monthIncidents as { day: string; count: number }[], monthStart, now)
  };
}

export async function getStationIncidentsGroupedByCostaRicaDay(stationKey: string) {
  const station = await db.query.stations.findFirst({
    where: eq(stations.stationKey, stationKey),
    columns: { id: true }
  });
  if (!station) throw new Error("Station not found");

  const now = new Date();
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const result = await db
    .select({
      day: costaRicaDayKey(incidents.incidentTimestamp),
      count: sql<number>`COUNT(*)`
    })
    .from(dispatchedStations)
    .innerJoin(incidents, eq(dispatchedStations.incidentId, incidents.id))
    .where(
      and(
        eq(dispatchedStations.stationId, station.id),
        between(incidents.incidentTimestamp, last7Start, now)
      )
    )
    .groupBy(costaRicaDayKey(incidents.incidentTimestamp))
    .orderBy(costaRicaDayKey(incidents.incidentTimestamp));

  return result;
}

export async function getStationIncidentsGroupedByCostaRicaDay30Days(stationKey: string) {
  const station = await db.query.stations.findFirst({
    where: eq(stations.stationKey, stationKey),
    columns: { id: true }
  });
  if (!station) throw new Error("Station not found");

  const now = new Date();
  const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const result = await db
    .select({
      day: costaRicaDayKey(incidents.incidentTimestamp),
      count: sql<number>`COUNT(*)`
    })
    .from(dispatchedStations)
    .innerJoin(incidents, eq(dispatchedStations.incidentId, incidents.id))
    .where(
      and(
        eq(dispatchedStations.stationId, station.id),
        between(incidents.incidentTimestamp, last30Start, now)
      )
    )
    .groupBy(costaRicaDayKey(incidents.incidentTimestamp))
    .orderBy(costaRicaDayKey(incidents.incidentTimestamp));

  return result;
}

export async function getStationIncidentsByHour(stationKey: string) {
  const station = await db.query.stations.findFirst({
    where: eq(stations.stationKey, stationKey),
    columns: { id: true }
  });
  if (!station) throw new Error("Station not found");

  const now = new Date();
  const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const result = await db
    .select({
      hour: costaRicaHourOfDay(incidents.incidentTimestamp),
      count: sql<number>`COUNT(*)`
    })
    .from(dispatchedStations)
    .innerJoin(incidents, eq(dispatchedStations.incidentId, incidents.id))
    .where(
      and(
        eq(dispatchedStations.stationId, station.id),
        between(incidents.incidentTimestamp, last30Start, now)
      )
    )
    .groupBy(costaRicaHourOfDay(incidents.incidentTimestamp))
    .orderBy(costaRicaHourOfDay(incidents.incidentTimestamp));

  const hourlyData: { hour: number; count: number }[] = [];
  for (let i = 0; i < 24; i++) {
    const hour = result.find((r) => Number(r.hour) === i);
    hourlyData.push({
      hour: i,
      count: hour ? Number(hour.count) : 0
    });
  }

  return hourlyData;
}

export async function getStationIncidentsByTopLevelType(stationKey: string) {
  const station = await db.query.stations.findFirst({
    where: eq(stations.stationKey, stationKey),
    columns: { id: true }
  });
  if (!station) throw new Error("Station not found");

  const now = new Date();
  const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const recentIncidents = await db
    .select({
      incidentCode: incidents.incidentCode
    })
    .from(incidents)
    .innerJoin(dispatchedStations, eq(dispatchedStations.incidentId, incidents.id))
    .where(
      and(
        eq(dispatchedStations.stationId, station.id),
        between(incidents.incidentTimestamp, last30Start, now),
        not(isNull(incidents.incidentCode))
      )
    );

  const groupedIncidents = recentIncidents.reduce<Record<string, number>>((acc, incident) => {
    if (!incident.incidentCode) return acc;
    const parentCode = incident.incidentCode.split(".")[0];
    if (parentCode) {
      acc[parentCode] = (acc[parentCode] || 0) + 1;
    }
    return acc;
  }, {});

  const parentTypes = await db.query.incidentTypes.findMany({
    where: inArray(incidentTypes.incidentCode, Object.keys(groupedIncidents)),
    columns: {
      incidentCode: true,
      name: true
    }
  });

  return parentTypes
    .map((type) => ({
      name: type.name,
      incident_code: type.incidentCode,
      count: groupedIncidents[type.incidentCode] || 0
    }))
    .sort((a, b) => b.count - a.count);
}
