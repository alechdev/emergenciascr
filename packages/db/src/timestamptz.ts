import {
  type AnyPgTable,
  PgTimestamp,
  PgTimestampBuilder,
  type PgTimestampBuilderInitial
} from "drizzle-orm/pg-core";

import type { ColumnBaseConfig, ColumnBuilderBaseConfig } from "drizzle-orm";

/**
 * Postgres output for `timestamptz`: `0001-01-01 05:36:13+00` as text, `0001-01-01T05:36:13+00:00`
 * inside JSON (relational queries), and offsets with seconds (`-05:36:13`, Costa Rica's local
 * mean time) for old dates in a session that isn't in UTC.
 */
const PG_TIMESTAMPTZ =
  /^(\d{4,})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)( BC)?$/;

/**
 * Parses a `timestamptz` as Postgres sends it. drizzle's own `new Date(value)` reads years below
 * 100 as 19xx or 20xx (`0001-01-01 05:36:13+00`, the legacy sync's SIGAE placeholder, becomes
 * 2001) and rejects offsets with seconds.
 */
export function parsePgTimestamptz(value: string): Date {
  const match = PG_TIMESTAMPTZ.exec(value);
  if (!match) return new Date(value);
  const [, year, month, day, hours, minutes, seconds, fraction = "", utc, sign] = match;
  const [offsetHours = "0", offsetMinutes = "0", offsetSeconds = "0", bc] = match.slice(10);

  const date = new Date(0);
  // setUTCFullYear, unlike Date.UTC, keeps years 0 to 99 as they are.
  date.setUTCFullYear(bc ? 1 - Number(year) : Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(
    Number(hours),
    Number(minutes),
    Number(seconds),
    Number(fraction.padEnd(3, "0").slice(0, 3))
  );
  if (!utc) {
    const offsetMs =
      (Number(offsetHours) * 3600 + Number(offsetMinutes) * 60 + Number(offsetSeconds)) * 1000;
    date.setTime(date.getTime() - (sign === "-" ? -offsetMs : offsetMs));
  }
  return date;
}

class PgTimestamptz<T extends ColumnBaseConfig<"date", "PgTimestamp">> extends PgTimestamp<T> {
  override mapFromDriverValue = (value: string): Date | null => parsePgTimestamptz(value);
}

/** Keeps drizzle's `PgTimestamp` kind, so drizzle-kit and drizzle-zod treat it as `timestamp`. */
class PgTimestamptzBuilder<
  T extends ColumnBuilderBaseConfig<"date", "PgTimestamp">
> extends PgTimestampBuilder<T> {
  build(table: AnyPgTable<{ name: string }>) {
    return new PgTimestamptz(table, this.config as never);
  }
}

/**
 * Every timestamp column is an instant (`timestamptz`; the API returns them as UTC ISO strings):
 * `timestamp({ withTimezone: true })` that reads any year Postgres can send.
 */
export const timestamptz = (): PgTimestampBuilderInitial<""> =>
  new PgTimestamptzBuilder("", true, undefined) as PgTimestampBuilderInitial<"">;
