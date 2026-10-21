/**
 * Costa Rica time for everything shown to people and for every day, month or year boundary,
 * whatever the time zone of the server (UTC in production) or the browser. Instants stay
 * instants: the database and the API hold UTC, and only formatting and calendar math go through
 * here, so the server and the browser render the same text.
 *
 * Wall-clock times are converted with the zone's rules through `Intl`, not a fixed `-06:00`.
 * Costa Rica has been UTC-6 without daylight saving time since 1992, but it observed DST in
 * 1979–1980 and 1991–1992, and the zone rules handle those dates for free.
 */
export const COSTA_RICA_TIME_ZONE = "America/Costa_Rica";
export const COSTA_RICA_LOCALE = "es-CR";

export type DateInput = Date | string | number;

/** The formats the site shows, with the Spanish (`es-CR`) output for 2026-10-11T02:25:19Z. */
export const COSTA_RICA_DATE_FORMATS = {
  /** "10 de octubre de 2026" */
  longDate: { day: "2-digit", month: "long", year: "numeric" },
  /** "8:25 p. m." */
  time: { hour: "numeric", minute: "2-digit", hour12: true },
  /** "08:25 p. m." */
  paddedTime: { hour: "2-digit", minute: "2-digit", hour12: true },
  /** "10 de octubre de 2026 a las 8:25 p. m." */
  longDateTime: {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  },
  /** "10 de octubre de 2026 a las 08:25 p. m." */
  longDatePaddedTime: {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  },
  /** "10 oct 2026, 08:25 p. m." */
  shortDateTime: {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  },
  /** "10 oct" */
  dayMonth: { day: "numeric", month: "short" },
  /** "10 de octubre de 2026" (day not padded) */
  dayMonthYear: { day: "numeric", month: "long", year: "numeric" },
  /** "sábado, 10 de octubre" */
  weekdayDayMonth: { weekday: "long", day: "numeric", month: "long" }
} as const satisfies Record<string, CostaRicaDateFormatOptions>;

export type CostaRicaDateFormat = keyof typeof COSTA_RICA_DATE_FORMATS;
export type CostaRicaDateFormatOptions = Omit<Intl.DateTimeFormatOptions, "timeZone">;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A cached `Intl.DateTimeFormat` that always formats in Costa Rica time. */
export function costaRicaDateTimeFormat(
  options: CostaRicaDateFormatOptions,
  locale: string = COSTA_RICA_LOCALE
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: COSTA_RICA_TIME_ZONE });
    formatters.set(key, formatter);
  }
  return formatter;
}

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Formats an instant in Costa Rica time, with one of the site's formats or explicit options
 * (the time zone can't be overridden). An invalid date gives `""`, where `Intl` would throw
 * and fail the whole server render.
 */
export function formatCostaRicaDate(
  value: DateInput,
  format: CostaRicaDateFormat | CostaRicaDateFormatOptions,
  locale: string = COSTA_RICA_LOCALE
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const options = typeof format === "string" ? COSTA_RICA_DATE_FORMATS[format] : format;
  return costaRicaDateTimeFormat(options, locale).format(date);
}

export type CostaRicaDateParts = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
  second: number;
};

const PARTS_OPTIONS: CostaRicaDateFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23"
};

/** The Costa Rica wall-clock fields of an instant. */
export function getCostaRicaDateParts(value: DateInput): CostaRicaDateParts {
  const parts = costaRicaDateTimeFormat(PARTS_OPTIONS, "en-US").formatToParts(toDate(value));
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second")
  };
}

export function getCostaRicaYear(value: DateInput = new Date()): number {
  return getCostaRicaDateParts(value).year;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** The Costa Rica date of an instant as `YYYY-MM-DD`, the key the SQL day buckets use. */
export function getCostaRicaDateKey(value: DateInput): string {
  const { year, month, day } = getCostaRicaDateParts(value);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function isSameCostaRicaDay(a: DateInput, b: DateInput): boolean {
  return getCostaRicaDateKey(a) === getCostaRicaDateKey(b);
}

/** Milliseconds Costa Rica is ahead of UTC at an instant (negative: -6 h). */
function costaRicaOffsetMs(instantMs: number): number {
  const p = getCostaRicaDateParts(instantMs);
  const wallMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallMs - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant of a Costa Rica wall-clock time. Fields overflow like `Date.UTC`, so day 0 is the
 * last day of the previous month and month 13 is January of the next year. A time skipped by a
 * DST change (midnight on 25 February 1979) moves forward by the skipped hour.
 */
export function costaRicaInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): Date {
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const firstOffsetMs = costaRicaOffsetMs(wallMs);
  const guessMs = wallMs - firstOffsetMs;
  const secondOffsetMs = costaRicaOffsetMs(guessMs);
  if (secondOffsetMs === firstOffsetMs) return new Date(guessMs);
  // The offset changes between the two instants: keep the one whose offset gives back this wall
  // time. In a DST gap neither does, and the later one is the same time after the change.
  const correctedMs = wallMs - secondOffsetMs;
  if (costaRicaOffsetMs(correctedMs) === secondOffsetMs) return new Date(correctedMs);
  return new Date(Math.max(guessMs, correctedMs));
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The year, month (1–12) and day of a `YYYY-MM-DD` key, or `null` when it isn't one. */
export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** A `YYYY-MM-DD` string names a Costa Rica day; anything else is an instant. */
function dayFields(value: DateInput): { year: number; month: number; day: number } {
  if (typeof value === "string") {
    const fields = parseDateKey(value);
    if (fields) return fields;
  }
  return getCostaRicaDateParts(value);
}

/**
 * Midnight in Costa Rica starting the day of an instant or of a `YYYY-MM-DD` key, plus `addDays`
 * days. A key is not parsed like `new Date("2026-10-10")`, which is UTC midnight and so the 9th
 * in Costa Rica.
 */
export function startOfCostaRicaDay(value: DateInput, addDays = 0): Date {
  const { year, month, day } = dayFields(value);
  return costaRicaInstant(year, month, day + addDays);
}

/** The last millisecond of the Costa Rica day of an instant or of a `YYYY-MM-DD` key. */
export function endOfCostaRicaDay(value: DateInput): Date {
  return new Date(startOfCostaRicaDay(value, 1).getTime() - 1);
}

/** The start of the Costa Rica hour of an instant. */
export function startOfCostaRicaHour(value: DateInput): Date {
  const { year, month, day, hour } = getCostaRicaDateParts(value);
  return costaRicaInstant(year, month, day, hour);
}

/** Midnight in Costa Rica on 1 January; a year is `[start of y, start of y + 1)`. */
export function startOfCostaRicaYear(year: number): Date {
  return costaRicaInstant(year, 1, 1);
}

/** Midnight in Costa Rica on the first of a month (1–12, overflowing into other years). */
export function startOfCostaRicaMonth(year: number, month: number): Date {
  return costaRicaInstant(year, month, 1);
}

/**
 * A calendar day as a local `Date` at midnight, for date pickers and date-fns calendar math,
 * which work in the browser's time zone. It names a day and is never an instant: turn it back
 * into one with `startOfCostaRicaDay(getCalendarDateKey(date))`.
 */
export function calendarDateFromKey(key: string): Date | null {
  const fields = parseDateKey(key);
  if (!fields) return null;
  return new Date(fields.year, fields.month - 1, fields.day);
}

/** The `YYYY-MM-DD` key of a calendar day built by `calendarDateFromKey` or date-fns. */
export function getCalendarDateKey(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today in Costa Rica as a calendar day (see `calendarDateFromKey`). */
export function getCostaRicaCalendarToday(now: DateInput = new Date()): Date {
  const { year, month, day } = getCostaRicaDateParts(now);
  return new Date(year, month - 1, day);
}
