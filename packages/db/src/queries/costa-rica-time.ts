/**
 * Costa Rica time in SQL. `date_trunc`, `DATE()` and wall-clock `EXTRACT` fields (`hour`,
 * `dow`, ...) on a `timestamptz` follow the session's `TimeZone`, so day, hour and month buckets
 * convert to Costa Rica wall-clock time first. Durations and `EXTRACT(epoch ...)` don't depend
 * on the session and stay on the instants.
 */
import { COSTA_RICA_TIME_ZONE } from "@bomberoscr/lib/costa-rica-time";
import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

// Inlined rather than a bind parameter: a bucket appears in SELECT and GROUP BY, and Postgres
// only treats them as the same expression when they are identical, which two $n are not.
const ZONE = sql.raw(`'${COSTA_RICA_TIME_ZONE}'`);

/** The Costa Rica wall-clock time of a `timestamptz`, as a `timestamp` without time zone. */
export function inCostaRica(column: SQLWrapper): SQL {
  return sql`(${column} AT TIME ZONE ${ZONE})`;
}

/** The Costa Rica day of a `timestamptz`, as a `YYYY-MM-DD` key. */
export function costaRicaDayKey(column: SQLWrapper): SQL<string> {
  return sql<string>`to_char(date_trunc('day', ${inCostaRica(column)}), 'YYYY-MM-DD')`;
}

/** The Costa Rica hour of a `timestamptz`, as a `YYYY-MM-DD HH24:00:00` key. */
export function costaRicaHourKey(column: SQLWrapper): SQL<string> {
  return sql<string>`to_char(date_trunc('hour', ${inCostaRica(column)}), 'YYYY-MM-DD HH24:00:00')`;
}

/** The Costa Rica month of a `timestamptz`, as a `YYYY-MM` key. */
export function costaRicaMonthKey(column: SQLWrapper): SQL<string> {
  return sql<string>`to_char(date_trunc('month', ${inCostaRica(column)}), 'YYYY-MM')`;
}

/** The hour (0–23) of a `timestamptz` in Costa Rica. */
export function costaRicaHourOfDay(column: SQLWrapper): SQL<number> {
  return sql<number>`EXTRACT(HOUR FROM ${inCostaRica(column)})::int`;
}

/** The day of the week (0 Sunday – 6 Saturday) of a `timestamptz` in Costa Rica. */
export function costaRicaDayOfWeek(column: SQLWrapper): SQL<number> {
  return sql<number>`EXTRACT(DOW FROM ${inCostaRica(column)})::int`;
}
