/**
 * A SIGAE date as sent on the wire: Costa Rica wall-clock time without an offset
 * (`2026-10-10T20:25:19`, sometimes with fractional seconds). SIGAE uses
 * {@link SIGAE_MISSING_DATE} to mean "no value".
 */
export type SigaeDateString = string;

/** The only placeholder SIGAE has been seen to send for a missing date. */
export const SIGAE_MISSING_DATE = "0001-01-01T00:00:00";

/** Costa Rica has used UTC-6 with no daylight saving time since 1992. */
const COSTA_RICA_OFFSET_MS = -6 * 60 * 60 * 1000;

const SIGAE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/;

export function isSigaeDateString(value: unknown): value is SigaeDateString {
  return typeof value === "string" && wallClockToUtcMs(value) !== null;
}

/**
 * Parses a SIGAE date as Costa Rica time, independent of the process timezone.
 *
 * Returns `null` for {@link SIGAE_MISSING_DATE}, `null`/`undefined`/empty values and
 * strings that are not SIGAE dates. Other implausible dates (for example year 1900) are
 * returned as-is; deciding whether they are placeholders is up to the caller.
 */
export function parseSigaeDate(raw: SigaeDateString | null | undefined): Date | null {
  if (raw === null || raw === undefined || raw === "" || raw === SIGAE_MISSING_DATE) return null;
  const wallClockMs = wallClockToUtcMs(raw);
  if (wallClockMs === null) return null;
  return new Date(wallClockMs - COSTA_RICA_OFFSET_MS);
}

/**
 * Formats an instant as the Costa Rica calendar date (`YYYY-MM-DD`) for SIGAE requests,
 * whatever the process timezone.
 */
export function formatSigaeRequestDate(date: Date): string {
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new RangeError("Invalid date");
  const local = new Date(ms + COSTA_RICA_OFFSET_MS);
  const year = String(local.getUTCFullYear()).padStart(4, "0");
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Reads the wall-clock fields as if they were UTC, rejecting impossible dates. */
function wallClockToUtcMs(raw: string): number | null {
  const match = SIGAE_DATE_PATTERN.exec(raw);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const ms = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;

  // Date.UTC maps years 0-99 to 1900-1999, so set the year separately.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, ms);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  return date.getTime();
}
