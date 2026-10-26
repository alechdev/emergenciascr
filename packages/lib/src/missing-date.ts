/**
 * Missing times, as stored or serialized: `null`, unparsable, or a placeholder. sync-v2 stores a
 * missing time as `NULL`, but data from the legacy sync still has SIGAE's `0001-01-01T00:00:00`,
 * and a `NULL` that went through `new Date(0)` reads as the Unix epoch.
 *
 * The year is read in UTC: in Costa Rica (UTC-6) `0001-01-01T00:00:00Z` is still year 0 and the
 * epoch is still 1969, so a local-year check depends on the time zone of the server or browser.
 */
type DateInput = Date | string | number;

/** No real incident time is this old, so anything up to the end of 1970 is a placeholder. */
const LAST_PLACEHOLDER_YEAR = 1970;

export function isKnownDate<T extends DateInput>(value: T | null | undefined): value is T {
  if (value === null || value === undefined || value === "") return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getUTCFullYear() > LAST_PLACEHOLDER_YEAR;
}

export function isMissingDate(value: DateInput | null | undefined): boolean {
  return !isKnownDate(value);
}
