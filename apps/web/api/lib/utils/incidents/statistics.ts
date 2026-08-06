import { db } from "@bomberoscr/db/index";
import { incidents } from "@bomberoscr/db/schema";
import { and, between, eq, sql } from "drizzle-orm";

interface IncidentForStats {
  incidentTimestamp: Date;
  incidentCode: string | null;
  specificIncidentCode: string | null;
  cantonId: number | null;
  cantonName: string | null;
}

async function getIncidentStatistics(incident: IncidentForStats) {
  const year = incident.incidentTimestamp.getFullYear();
  const previousYear = year - 1;

  const incidentTypeCode = incident.specificIncidentCode || incident.incidentCode;
  const cantonId = incident.cantonId;

  // Calculate year boundaries for the incident's year and previous year
  const incidentYearStart = new Date(year, 0, 1);
  const incidentYearEnd = new Date(year, 11, 31, 23, 59, 59);
  const previousYearStart = new Date(previousYear, 0, 1);
  const previousYearEnd = new Date(previousYear, 11, 31, 23, 59, 59);

  const [typeInYear, typeInCanton, typeInPreviousYear] = await Promise.all([
    // Count of this incident type in the incident's year (full year)
    incidentTypeCode
      ? db
          .select({ count: sql<number>`count(*)::int` })
          .from(incidents)
          .where(
            and(
              eq(incidents.specificIncidentCode, incidentTypeCode),
              between(incidents.incidentTimestamp, incidentYearStart, incidentYearEnd)
            )
          )
      : Promise.resolve([{ count: 0 }]),

    // Count of this incident type in the incident's canton for that year
    cantonId && incidentTypeCode
      ? db
          .select({ count: sql<number>`count(*)::int` })
          .from(incidents)
          .where(
            and(
              eq(incidents.cantonId, cantonId),
              eq(incidents.specificIncidentCode, incidentTypeCode),
              between(incidents.incidentTimestamp, incidentYearStart, incidentYearEnd)
            )
          )
      : Promise.resolve([{ count: 0 }]),

    // Count of this incident type in the previous year (for comparison)
    incidentTypeCode
      ? db
          .select({ count: sql<number>`count(*)::int` })
          .from(incidents)
          .where(
            and(
              eq(incidents.specificIncidentCode, incidentTypeCode),
              between(incidents.incidentTimestamp, previousYearStart, previousYearEnd)
            )
          )
      : Promise.resolve([{ count: 0 }])
  ]);

  return {
    currentYear: year,
    currentYearCount: typeInYear[0]?.count ?? 0,
    currentYearCantonCount: typeInCanton[0]?.count ?? 0,
    cantonName: incident.cantonName,
    previousYear: previousYear,
    previousYearCount: typeInPreviousYear[0]?.count ?? 0
  };
}

export { getIncidentStatistics };
export type IncidentStatistics = Awaited<ReturnType<typeof getIncidentStatistics>>;
