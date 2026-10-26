import { type Database, db } from "@bomberoscr/db/index";
import { incidents } from "@bomberoscr/db/schema";
import { getCostaRicaYear, startOfCostaRicaYear } from "@bomberoscr/lib/costa-rica-time";
import { and, eq, gte, lt, sql } from "drizzle-orm";

interface IncidentForStats {
  incidentTimestamp: Date;
  incidentCode: string | null;
  specificIncidentCode: string | null;
  cantonId: number | null;
  cantonName: string | null;
}

async function getIncidentStatistics(incident: IncidentForStats, database: Database = db) {
  const year = getCostaRicaYear(incident.incidentTimestamp);
  const previousYear = year - 1;

  const incidentTypeCode = incident.specificIncidentCode || incident.incidentCode;
  const cantonId = incident.cantonId;

  // Costa Rica years, from midnight on 1 January to the next one
  const inYear = (target: number) =>
    and(
      gte(incidents.incidentTimestamp, startOfCostaRicaYear(target)),
      lt(incidents.incidentTimestamp, startOfCostaRicaYear(target + 1))
    );

  const [typeInYear, typeInCanton, typeInPreviousYear] = await Promise.all([
    // Count of this incident type in the incident's year (full year)
    incidentTypeCode
      ? database
          .select({ count: sql<number>`count(*)::int` })
          .from(incidents)
          .where(and(eq(incidents.specificIncidentCode, incidentTypeCode), inYear(year)))
      : Promise.resolve([{ count: 0 }]),

    // Count of this incident type in the incident's canton for that year
    cantonId && incidentTypeCode
      ? database
          .select({ count: sql<number>`count(*)::int` })
          .from(incidents)
          .where(
            and(
              eq(incidents.cantonId, cantonId),
              eq(incidents.specificIncidentCode, incidentTypeCode),
              inYear(year)
            )
          )
      : Promise.resolve([{ count: 0 }]),

    // Count of this incident type in the previous year (for comparison)
    incidentTypeCode
      ? database
          .select({ count: sql<number>`count(*)::int` })
          .from(incidents)
          .where(and(eq(incidents.specificIncidentCode, incidentTypeCode), inYear(previousYear)))
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
