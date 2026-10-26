import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function areCoordinatesValid(
  latitude: string | null | undefined,
  longitude: string | null | undefined
) {
  if (!latitude || !longitude) return false;
  return Number(latitude) !== 0 && Number(longitude) !== 0;
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  let relative = "hace un momento";

  if (diffDays > 0) {
    relative = `hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
  } else if (diffHours > 0) {
    relative = `hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  } else if (diffMinutes > 0) {
    relative = `hace ${diffMinutes} ${diffMinutes === 1 ? "minuto" : "minutos"}`;
  }

  return relative;
}

/**
 * Returns the relative time of a date in Spanish (es-CR) format.
 * Uses rounded units (weeks, months, years) for older dates.
 *
 * @param date - ISO string or date to evaluate.
 * @param reference - Optional fixed "current" time.  When omitted, `new Date()` is used.
 */
export function getRelativeTime(date: string, reference?: Date): string {
  const rtf = new Intl.RelativeTimeFormat("es-CR", { numeric: "auto" });
  const now = reference ?? new Date();
  const then = new Date(date);

  const diffInSeconds = (now.getTime() - then.getTime()) / 1000;

  if (Math.abs(diffInSeconds) < 60) {
    return rtf.format(-Math.round(diffInSeconds), "second");
  }

  const diffInMinutes = diffInSeconds / 60;
  if (Math.abs(diffInMinutes) < 60) {
    return rtf.format(-Math.round(diffInMinutes), "minute");
  }

  const diffInHours = diffInMinutes / 60;
  if (Math.abs(diffInHours) < 24) {
    return rtf.format(-Math.round(diffInHours), "hour");
  }

  const diffInDays = diffInHours / 24;
  if (Math.abs(diffInDays) < 7) {
    return rtf.format(-Math.round(diffInDays), "day");
  }

  const diffInWeeks = diffInDays / 7;
  if (Math.abs(diffInWeeks) < 4) {
    return rtf.format(-Math.round(diffInWeeks), "week");
  }

  const diffInMonths = diffInDays / 30;
  if (Math.abs(diffInMonths) < 12) {
    return rtf.format(-Math.round(diffInMonths), "month");
  }

  const diffInYears = diffInDays / 365;
  return rtf.format(-Math.round(diffInYears), "year");
}

/**
 * Formats a number of minutes into a human-readable string (e.g., "1h 30m" or "5m 30s")
 * @param minutes - The number of minutes to format
 */
export function formatMinutesToHMS(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  const secs = Math.floor((minutes * 60) % 60);

  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m ${secs}s`;
}
